import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kvRead } from "@/lib/kv";
import {
  getWarehouseBalanceDetailed,
  type WarehouseStorageBalanceRow,
} from "@/lib/altegio";

export type { WarehouseStorageBalanceRow };

export type WarehouseBalanceSource =
  | "legacy_manual"
  /** Ручний залишок попереднього місяця (KV) + signed month_net_change поточного місяця */
  | "manual_anchor_rollforward"
  | "monthly_snapshot"
  | "live_api"
  | "missing";

/** Кеш на процес: чи є колонка storageBreakdown (міграція 20260501120000) — щоб не викликати SELECT по неіснуючому полю (Prisma логує prisma:error навіть у catch) */
let financeSnapshotStorageBreakdownColumnExists: boolean | null = null;

async function financeSnapshotHasStorageBreakdownColumn(): Promise<boolean> {
  if (financeSnapshotStorageBreakdownColumnExists !== null) {
    return financeSnapshotStorageBreakdownColumnExists;
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'finance_warehouse_balance_snapshots'
          AND lower(column_name) = 'storagebreakdown'
      ) AS "exists"`,
    );
    financeSnapshotStorageBreakdownColumnExists = Boolean(rows[0]?.exists);
  } catch {
    financeSnapshotStorageBreakdownColumnExists = false;
  }
  return financeSnapshotStorageBreakdownColumnExists;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getKyivNowParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoDate: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "0";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  return {
    year,
    month,
    day,
    hour,
    minute,
    isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

function getWarehouseBalanceKey(year: number, month: number): string {
  return `finance:warehouse:balance:${year}:${month}`;
}

function getWarehouseMonthNetChangeKey(year: number, month: number): string {
  return `finance:warehouse:month_net_change:${year}:${month}`;
}

/**
 * Підписана «місяцева зміна» складу (грн) для rollforward: кінець місяця = ручний залишок попереднього місяця + це значення.
 * Ключ відсутній у KV → null (формула не застосовується). Ключ є → число, у т.ч. 0 або від’ємне.
 */
export async function readWarehouseMonthNetChangeUah(
  year: number,
  month: number,
): Promise<number | null> {
  try {
    const rawValue = await kvRead.getRaw(getWarehouseMonthNetChangeKey(year, month));
    if (rawValue === null || typeof rawValue !== "string") {
      return null;
    }
    try {
      const parsed = JSON.parse(rawValue);
      const value = (parsed as { value?: unknown })?.value ?? parsed;
      const numValue = typeof value === "number" ? value : parseFloat(String(value));
      return Number.isFinite(numValue) ? numValue : null;
    } catch {
      const numValue = parseFloat(rawValue);
      return Number.isFinite(numValue) ? numValue : null;
    }
  } catch (err) {
    console.error(
      `[finance/warehouse-balance] Не вдалося прочитати month_net_change для ${year}-${month}:`,
      err,
    );
    return null;
  }
}

export async function readLegacyManualWarehouseBalance(
  year: number,
  month: number,
): Promise<number | null> {
  try {
    const rawValue = await kvRead.getRaw(getWarehouseBalanceKey(year, month));
    if (rawValue === null || typeof rawValue !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue);
      const value = (parsed as any)?.value ?? parsed;
      const numValue = typeof value === "number" ? value : parseFloat(String(value));
      return Number.isFinite(numValue) && numValue >= 0 ? numValue : null;
    } catch {
      const numValue = parseFloat(rawValue);
      return Number.isFinite(numValue) && numValue >= 0 ? numValue : null;
    }
  } catch (err) {
    console.error(`[finance/warehouse-balance] Не вдалося прочитати legacy manual баланс для ${year}-${month}:`, err);
    return null;
  }
}

/** Останній календарний день місяця (YYYY-MM-DD) для знімку складу */
export function getMonthLastDayIso(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Якщо snapshot збережений старою логікою (наприклад, лише перша сторінка / без actual_cost),
 * live API дає іншу суму. Тоді при відкритті звіту один раз перезаписуємо snapshot у БД.
 */
const WAREHOUSE_SNAPSHOT_RECONCILE_FACTOR = 1.45;
const WAREHOUSE_SNAPSHOT_RECONCILE_MIN_GAP_UAH = 80_000;

function parseStorageBreakdownFromSnapshot(
  json: unknown,
): WarehouseStorageBalanceRow[] | undefined {
  if (json == null) return undefined;
  if (!Array.isArray(json)) return undefined;
  const out: WarehouseStorageBalanceRow[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const storageId = Number(r.storageId ?? r.storage_id ?? 0);
    const titleRaw = r.title;
    const title =
      typeof titleRaw === "string" && titleRaw.trim()
        ? titleRaw.trim()
        : `Склад #${Number.isFinite(storageId) ? storageId : 0}`;
    const bal = Number(r.balanceUah ?? r.balance ?? 0);
    if (!Number.isFinite(bal)) continue;
    out.push({
      storageId: Number.isFinite(storageId) ? storageId : 0,
      title,
      balanceUah: Math.round(bal * 100) / 100,
    });
  }
  return out.length ? out : undefined;
}

export async function getWarehouseBalanceForReportMonth(
  year: number,
  month: number,
): Promise<{
  balance: number;
  source: WarehouseBalanceSource;
  snapshotAt?: Date | null;
  /** Залишки по складах на останній день місяця (або на сьогодні для поточного місяця, якщо місяць ще не закінчився) */
  warehouseBalancePerStorage?: WarehouseStorageBalanceRow[];
}> {
  const manualBalance = await readLegacyManualWarehouseBalance(year, month);
  if (manualBalance !== null) {
    return { balance: manualBalance, source: "legacy_manual", snapshotAt: null };
  }

  const monthNetChange = await readWarehouseMonthNetChangeUah(year, month);
  if (monthNetChange !== null) {
    const prev = getPreviousMonth(year, month);
    const anchorPrev = await readLegacyManualWarehouseBalance(prev.year, prev.month);
    if (anchorPrev !== null) {
      const balance = Math.round((anchorPrev + monthNetChange) * 100) / 100;
      console.log(
        `[finance/warehouse-balance] Rollforward складу ${year}-${month}: якір ${prev.year}-${prev.month}=${anchorPrev} грн + зміна ${monthNetChange} → ${balance} грн`,
      );
      return {
        balance,
        source: "manual_anchor_rollforward",
        snapshotAt: null,
      };
    }
    console.warn(
      `[finance/warehouse-balance] Задано зміну складу за ${year}-${month} (${monthNetChange} грн), але в KV немає ручного балансу за попередній місяць (${prev.year}-${prev.month}) — rollforward пропущено`,
    );
  }

  // findUnique без storageBreakdown: на проді до міграції колонки Prisma інакше генерує SELECT з неіснуючим полем і падає.
  const snapshot = await prisma.financeWarehouseBalanceSnapshot.findUnique({
    where: {
      year_month: { year, month },
    },
    select: {
      totalBalance: true,
      snapshotAt: true,
    },
  });
  if (snapshot) {
    let breakdownJson: unknown = undefined;
    if (await financeSnapshotHasStorageBreakdownColumn()) {
      try {
        const rows = await prisma.$queryRaw<Array<{ storageBreakdown: unknown }>>(
          Prisma.sql`
            SELECT "storageBreakdown"
            FROM "finance_warehouse_balance_snapshots"
            WHERE "year" = ${year} AND "month" = ${month}
            LIMIT 1
          `,
        );
        breakdownJson = rows[0]?.storageBreakdown ?? undefined;
      } catch (err) {
        console.warn(
          `[finance/warehouse-balance] Не вдалося прочитати storageBreakdown ${year}-${month}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    let warehouseBalancePerStorage = parseStorageBreakdownFromSnapshot(breakdownJson);
    const snapTotal = snapshot.totalBalance;
    const monthEnd = getMonthLastDayIso(year, month);

    try {
      const detailed = await getWarehouseBalanceDetailed({ date: monthEnd });
      const liveTotal = detailed.total;
      const gap = Math.abs(liveTotal - snapTotal);
      const undercounted =
        liveTotal > snapTotal * WAREHOUSE_SNAPSHOT_RECONCILE_FACTOR &&
        gap >= WAREHOUSE_SNAPSHOT_RECONCILE_MIN_GAP_UAH;
      const overcounted =
        snapTotal > liveTotal * WAREHOUSE_SNAPSHOT_RECONCILE_FACTOR &&
        gap >= WAREHOUSE_SNAPSHOT_RECONCILE_MIN_GAP_UAH;

      // Не підміняємо snapshot «нулями» або дуже малими сумами (часткова відповідь API).
      const liveLooksPlausible = Number.isFinite(liveTotal) && liveTotal >= 25_000;
      const overcountOk =
        overcounted && liveTotal >= snapTotal * 0.35;

      if (liveLooksPlausible && (undercounted || overcountOk)) {
        console.warn(
          `[finance/warehouse-balance] Знімок ${year}-${month} розходиться з API (snapshot=${snapTotal}, live=${liveTotal}, monthEnd=${monthEnd}) — оновлюємо запис`,
        );
        await saveWarehouseBalanceSnapshot({
          year,
          month,
          totalBalance: liveTotal,
          storageBreakdown: detailed.storages.length > 0 ? detailed.storages : null,
          snapshotAt: new Date(),
        });
        warehouseBalancePerStorage =
          detailed.storages.length > 0 ? detailed.storages : warehouseBalancePerStorage;
        return {
          balance: liveTotal,
          source: "monthly_snapshot",
          snapshotAt: new Date(),
          warehouseBalancePerStorage,
        };
      }
    } catch (reconcileErr) {
      console.warn(
        `[finance/warehouse-balance] Не вдалося зрівняти snapshot з live для ${year}-${month}:`,
        reconcileErr instanceof Error ? reconcileErr.message : reconcileErr,
      );
    }

    return {
      balance: snapTotal,
      source: "monthly_snapshot",
      snapshotAt: snapshot.snapshotAt,
      warehouseBalancePerStorage,
    };
  }

  const nowKyiv = getKyivNowParts();
  if (year === nowKyiv.year && month === nowKyiv.month) {
    try {
      const monthEnd = getMonthLastDayIso(year, month);
      const effectiveDate = minIsoDate(monthEnd, nowKyiv.isoDate);
      const detailed = await getWarehouseBalanceDetailed({ date: effectiveDate });
      console.log(
        `[finance/warehouse-balance] Live склад за ${effectiveDate}: total=${detailed.total}, rows=${detailed.storages.length}`,
      );
      return {
        balance: detailed.total,
        source: "live_api",
        snapshotAt: null,
        warehouseBalancePerStorage:
          detailed.storages.length > 0 ? detailed.storages : undefined,
      };
    } catch (err) {
      console.error(`[finance/warehouse-balance] Не вдалося отримати live баланс для ${year}-${month}:`, err);
    }
  }

  return { balance: 0, source: "missing", snapshotAt: null };
}

export function getPreviousMonth(year: number, month: number): {
  year: number;
  month: number;
} {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

export function getSnapshotTargetMonth(now = new Date()): {
  shouldCapture: boolean;
  targetYear: number;
  targetMonth: number;
  kyivNow: ReturnType<typeof getKyivNowParts>;
} {
  const kyivNow = getKyivNowParts(now);
  const previousMonth = getPreviousMonth(kyivNow.year, kyivNow.month);
  const shouldCapture = kyivNow.day === 1 && kyivNow.hour === 0;

  return {
    shouldCapture,
    targetYear: previousMonth.year,
    targetMonth: previousMonth.month,
    kyivNow,
  };
}

export async function saveWarehouseBalanceSnapshot(params: {
  year: number;
  month: number;
  totalBalance: number;
  /** Знімок залишків по складах на monthEnd (для блоку №4) */
  storageBreakdown?: WarehouseStorageBalanceRow[] | null;
  snapshotAt?: Date;
}): Promise<void> {
  const { year, month, totalBalance, storageBreakdown, snapshotAt = new Date() } = params;
  const breakdownJson: Prisma.InputJsonValue | undefined =
    Array.isArray(storageBreakdown) && storageBreakdown.length > 0
      ? (storageBreakdown as unknown as Prisma.InputJsonValue)
      : undefined;

  const tryUpsert = async (includeBreakdown: boolean) => {
    await prisma.financeWarehouseBalanceSnapshot.upsert({
      where: {
        year_month: { year, month },
      },
      update: {
        totalBalance,
        snapshotAt,
        ...(includeBreakdown && breakdownJson !== undefined
          ? { storageBreakdown: breakdownJson }
          : {}),
      },
      create: {
        year,
        month,
        totalBalance,
        snapshotAt,
        ...(includeBreakdown && breakdownJson !== undefined
          ? { storageBreakdown: breakdownJson }
          : {}),
      },
    });
  };

  try {
    await tryUpsert(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isMissingColumn =
      breakdownJson !== undefined &&
      (msg.includes("storageBreakdown") || msg.includes("42703") || msg.includes("does not exist"));
    if (!isMissingColumn) {
      throw err;
    }
    console.warn(
      `[finance/warehouse-balance] Upsert з storageBreakdown не вдався, зберігаємо лише totalBalance. Застосуйте міграції на БД:`,
      msg,
    );
    await tryUpsert(false);
  }
}
