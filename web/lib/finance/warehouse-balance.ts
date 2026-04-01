import { prisma } from "@/lib/prisma";
import { kvRead } from "@/lib/kv";
import { getWarehouseBalance } from "@/lib/altegio";

export type WarehouseBalanceSource =
  | "legacy_manual"
  | "monthly_snapshot"
  | "live_api"
  | "missing";

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

export async function getWarehouseBalanceForReportMonth(
  year: number,
  month: number,
): Promise<{
  balance: number;
  source: WarehouseBalanceSource;
  snapshotAt?: Date | null;
}> {
  const manualBalance = await readLegacyManualWarehouseBalance(year, month);
  if (manualBalance !== null) {
    return { balance: manualBalance, source: "legacy_manual", snapshotAt: null };
  }

  const snapshot = await prisma.financeWarehouseBalanceSnapshot.findUnique({
    where: {
      year_month: { year, month },
    },
  });
  if (snapshot) {
    return {
      balance: snapshot.totalBalance,
      source: "monthly_snapshot",
      snapshotAt: snapshot.snapshotAt,
    };
  }

  const nowKyiv = getKyivNowParts();
  if (year === nowKyiv.year && month === nowKyiv.month) {
    try {
      const balance = await getWarehouseBalance({ date: nowKyiv.isoDate });
      return { balance, source: "live_api", snapshotAt: null };
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
  snapshotAt?: Date;
}): Promise<void> {
  const { year, month, totalBalance, snapshotAt = new Date() } = params;
  await prisma.financeWarehouseBalanceSnapshot.upsert({
    where: {
      year_month: { year, month },
    },
    update: {
      totalBalance,
      snapshotAt,
    },
    create: {
      year,
      month,
      totalBalance,
      snapshotAt,
    },
  });
}
