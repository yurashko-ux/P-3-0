// web/app/api/bank/operations/route.ts
// GET: операції з усіх рахунків за період, з фільтрами direction та connectionId

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { syncAltegioBalanceForBankAccount } from "@/lib/altegio/accounts";
import { buildAltegioBalanceAfterTxnFromOpeningAnchor } from "@/lib/bank/altegio-opening-anchor";
import {
  computeFopTurnoverForPage,
  computeYtdIncomingKopThrough,
  type AccountFopTurnoverConfig,
} from "@/lib/bank/fop-turnover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const LIVE_ALTEGIO_SYNC_TTL_MS = 5 * 60 * 1000;
/** Як у GET /api/bank/connections: пауза перед читанням після запису (Accelerate / read replica). */
const MAX_WAIT_REPLICA_SEC = 10;

function getCurrentMonthRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

function parseYmdBoundary(value: string, boundary: "start" | "end"): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("Невірний формат дати");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("Невірний формат дати");
  }
  const date =
    boundary === "start"
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (Number.isNaN(date.getTime())) throw new Error("Невірний формат дати");
  return date;
}

function parseCursor(cursor: string | null): { time: Date; id: string } | null {
  if (!cursor) return null;
  const [timeRaw, idRaw] = cursor.split("|");
  if (!timeRaw || !idRaw) return null;
  const time = new Date(timeRaw);
  if (Number.isNaN(time.getTime())) return null;
  return { time, id: idRaw };
}

function isMissingAltegioBankColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("altegioBalanceSnapshot") ||
    message.includes("altegioAccountTitleSnapshot") ||
    message.includes("altegioBalanceCapturedAt") ||
    message.includes("altegioSyncErrorSnapshot")
  );
}

function isMissingFopTurnoverColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("altegioMonthlyTurnoverManual") ||
    message.includes("fopAnnualTurnoverLimitKop") ||
    message.includes("ytdIncomingManualKop") ||
    message.includes("ytdIncomingManualThroughDate")
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const waitSec = Math.min(
    MAX_WAIT_REPLICA_SEC,
    Math.max(0, parseInt(req.nextUrl.searchParams.get("waitForReplica") ?? "0", 10) || 0)
  );
  if (waitSec > 0) {
    console.log("[bank/operations] GET waitForReplica:", waitSec, "s");
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const direction = req.nextUrl.searchParams.get("direction") || "all";
  const connectionIdParam = req.nextUrl.searchParams.get("connectionId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const cursorParam = req.nextUrl.searchParams.get("cursor");

  let fromDate: Date;
  let toDate: Date;
  try {
    if (fromParam && toParam) {
      fromDate = parseYmdBoundary(fromParam, "start");
      toDate = parseYmdBoundary(toParam, "end");
    } else {
      const range = getCurrentMonthRange();
      fromDate = range.from;
      toDate = range.to;
    }
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new Error("Невірний формат дати");
    }
  } catch {
    return NextResponse.json(
      { error: "Невірні параметри from/to (очікується ISO дата)" },
      { status: 400 }
    );
  }

  const connectionId = connectionIdParam && connectionIdParam.trim() ? connectionIdParam.trim() : null;
  const parsedCursor = parseCursor(cursorParam);
  const parsedLimit = Number.parseInt(limitParam ?? "50", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

  /** Один момент для ЗЛ у цій відповіді (ближче до футера, ніж після всіх запитів). */
  const fopZlAsOf = new Date();

  try {
    const accountWhere: { connectionId?: string; includeInOperationsTable: boolean } = {
      includeInOperationsTable: true,
    };
    if (connectionId) accountWhere.connectionId = connectionId;

    const where: any = {
      time: { gte: fromDate, lte: toDate },
      account: accountWhere,
    };

    if (direction === "in") {
      where.amount = { gt: BigInt(0) };
    } else if (direction === "out") {
      where.amount = { lt: BigInt(0) };
    }

    if (parsedCursor) {
      where.AND = [
        {
          OR: [
            { time: { lt: parsedCursor.time } },
            { time: parsedCursor.time, id: { lt: parsedCursor.id } },
          ],
        },
      ];
    }

    let items: any[];
    try {
      items = await prisma.bankStatementItem.findMany({
        where,
        orderBy: [{ time: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          time: true,
          amount: true,
          balance: true,
          description: true,
          comment: true,
          counterName: true,
          altegioBalanceSnapshot: true,
          altegioAccountTitleSnapshot: true,
          altegioBalanceCapturedAt: true,
          altegioSyncErrorSnapshot: true,
          account: {
            select: {
              id: true,
              maskedPan: true,
              iban: true,
              externalId: true,
              currencyCode: true,
              connection: {
                select: { id: true, name: true, clientName: true },
              },
            },
          },
        },
      });
    } catch (error) {
      if (!isMissingAltegioBankColumnError(error)) {
        throw error;
      }

      console.warn(
        "[bank/operations] Snapshot-поля Altegio для BankStatementItem ще недоступні в БД, віддаємо дані без колонки Баланс Альтеджіо:",
        error instanceof Error ? error.message : String(error),
      );

      items = await prisma.bankStatementItem.findMany({
        where,
        orderBy: [{ time: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          time: true,
          amount: true,
          balance: true,
          description: true,
          comment: true,
          counterName: true,
          account: {
            select: {
              id: true,
              maskedPan: true,
              iban: true,
              externalId: true,
              currencyCode: true,
              connection: {
                select: { id: true, name: true, clientName: true },
              },
            },
          },
        },
      });
    }

    function last4(s: string | null): string {
      if (!s) return "—";
      const digits = s.replace(/\D/g, "");
      return digits.slice(-4) || "—";
    }

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const pageAccountIds = [...new Set(pageItems.map((row) => row.account.id))];

    // Пріоритет актуальних даних Altegio: перед побудовою рядків намагаємось освіжити баланс рахунку.
    // Оцінка від точки відліку залишається fallback, якщо live-синк недоступний.
    try {
      const syncCandidates = await prisma.bankAccount.findMany({
        where: { id: { in: pageAccountIds } },
        select: {
          id: true,
          currencyCode: true,
          altegioBalance: true,
          altegioBalanceUpdatedAt: true,
        },
      });
      for (const acc of syncCandidates) {
        if ((acc.currencyCode ?? 980) !== 980) continue;
        /** Без live-балансу колонка падає в «оцінку» — тому завжди пробуємо синк, поки баланс порожній. */
        const stale =
          acc.altegioBalance == null ||
          !acc.altegioBalanceUpdatedAt ||
          Date.now() - acc.altegioBalanceUpdatedAt.getTime() > LIVE_ALTEGIO_SYNC_TTL_MS;
        if (!stale) continue;
        try {
          await syncAltegioBalanceForBankAccount(acc.id);
        } catch (syncErr) {
          console.warn(
            "[bank/operations] live Altegio sync skipped for account:",
            acc.id,
            syncErr instanceof Error ? syncErr.message : String(syncErr)
          );
        }
      }
    } catch (syncBatchErr) {
      console.warn(
        "[bank/operations] live Altegio sync batch skipped:",
        syncBatchErr instanceof Error ? syncBatchErr.message : String(syncBatchErr)
      );
    }

    let balanceAfterByItemId = new Map<string, string>();
    let openingDateIsoByAccountId = new Map<string, string>();
    try {
      const anchor = await buildAltegioBalanceAfterTxnFromOpeningAnchor(
        pageItems.map((row) => ({ id: row.id, accountId: row.account.id, time: row.time })),
        toDate
      );
      balanceAfterByItemId = anchor.balanceAfterByItemId;
      openingDateIsoByAccountId = anchor.openingDateIsoByAccountId;
    } catch (anchorErr) {
      console.warn(
        "[bank/operations] Розрахунок балансу Altegio від точки відліку пропущено:",
        anchorErr instanceof Error ? anchorErr.message : String(anchorErr)
      );
    }

    const fopConfigs = new Map<string, AccountFopTurnoverConfig>();
    const freshAltegioByAccountId = new Map<
      string,
      { balance: bigint | null; title: string | null; updatedAt: Date | null; syncError: string | null }
    >();
    try {
      const freshRows = await prisma.bankAccount.findMany({
        where: { id: { in: pageAccountIds } },
        select: {
          id: true,
          altegioBalance: true,
          altegioAccountTitle: true,
          altegioBalanceUpdatedAt: true,
          altegioSyncError: true,
        },
      });
      for (const row of freshRows) {
        freshAltegioByAccountId.set(row.id, {
          balance: row.altegioBalance,
          title: row.altegioAccountTitle,
          updatedAt: row.altegioBalanceUpdatedAt,
          syncError: row.altegioSyncError,
        });
      }
    } catch (freshErr) {
      console.warn(
        "[bank/operations] cannot read fresh altegio balances:",
        freshErr instanceof Error ? freshErr.message : String(freshErr)
      );
    }

    /**
     * Окремий findMany лише для ліміту + ручного YTD — без altegioMonthlyTurnoverManual тощо.
     * Якщо «широкий» select для fopConfigs потрапляє в fallback і обнуляє YTD, колонка ЗЛ і далі
     * бере коректні поля з БД (як футер), а не копію з обнуленого accRows.
     */
    type AccZlRow = {
      id: string;
      currencyCode: number | null;
      fopAnnualTurnoverLimitKop: bigint | null;
      ytdIncomingManualKop: bigint | null;
      ytdIncomingManualThroughDate: Date | null;
    };
    let accRowsForZl: AccZlRow[] = [];
    if (pageAccountIds.length > 0) {
      try {
        accRowsForZl = await prisma.bankAccount.findMany({
          where: { id: { in: pageAccountIds } },
          select: {
            id: true,
            currencyCode: true,
            fopAnnualTurnoverLimitKop: true,
            ytdIncomingManualKop: true,
            ytdIncomingManualThroughDate: true,
          },
        });
      } catch (zlErr) {
        const m = zlErr instanceof Error ? zlErr.message : String(zlErr);
        const zlColsMissing =
          m.includes("ytdIncomingManualKop") ||
          m.includes("ytdIncomingManualThroughDate") ||
          m.includes("fopAnnualTurnoverLimitKop");
        if (zlColsMissing) {
          console.warn(
            "[bank/operations] ZL: select з YTD/лімітом недоступний, пробуємо лише ліміт:",
            m,
          );
          try {
            const rows = await prisma.bankAccount.findMany({
              where: { id: { in: pageAccountIds } },
              select: {
                id: true,
                currencyCode: true,
                fopAnnualTurnoverLimitKop: true,
              },
            });
            accRowsForZl = rows.map((r) => ({
              ...r,
              ytdIncomingManualKop: null,
              ytdIncomingManualThroughDate: null,
            }));
          } catch (zlErr2) {
            console.warn(
              "[bank/operations] ZL: не вдалося прочитати ліміт:",
              zlErr2 instanceof Error ? zlErr2.message : String(zlErr2),
            );
            accRowsForZl = [];
          }
        } else {
          throw zlErr;
        }
      }
    }

    const fopAnnualRemainingNowByAccountId = new Map<string, string>();
    for (const a of accRowsForZl) {
      if ((a.currencyCode ?? 980) !== 980) continue;
      const lim = a.fopAnnualTurnoverLimitKop;
      if (lim == null || lim <= 0n) continue;
      try {
        const ytdNow = await computeYtdIncomingKopThrough(a.id, fopZlAsOf, {
          ytdIncomingManualKop: a.ytdIncomingManualKop,
          ytdIncomingManualThroughDate: a.ytdIncomingManualThroughDate,
        });
        fopAnnualRemainingNowByAccountId.set(a.id, (lim - ytdNow).toString());
      } catch (remErr) {
        console.warn(
          "[bank/operations] ЗЛ (узгоджено з футером) для рахунку пропущено:",
          a.id,
          remErr instanceof Error ? remErr.message : String(remErr),
        );
      }
    }

    type AccFopRow = {
      id: string;
      currencyCode: number | null;
      altegioOpeningBalanceDate: Date | null;
      altegioMonthlyTurnoverManual: bigint | null;
      ytdIncomingManualKop: bigint | null;
      ytdIncomingManualThroughDate: Date | null;
      fopAnnualTurnoverLimitKop: bigint | null;
    };
    let accRows: AccFopRow[] = [];
    try {
      accRows = await prisma.bankAccount.findMany({
        where: { id: { in: pageAccountIds } },
        select: {
          id: true,
          currencyCode: true,
          altegioOpeningBalanceDate: true,
          altegioMonthlyTurnoverManual: true,
          ytdIncomingManualKop: true,
          ytdIncomingManualThroughDate: true,
          fopAnnualTurnoverLimitKop: true,
        },
      });
    } catch (fopErr) {
      if (!isMissingFopTurnoverColumnError(fopErr)) throw fopErr;
      console.warn(
        "[bank/operations] Повний select полів ФОП недоступний, пробуємо без YTD:",
        fopErr instanceof Error ? fopErr.message : String(fopErr),
      );
      try {
        const partial = await prisma.bankAccount.findMany({
          where: { id: { in: pageAccountIds } },
          select: {
            id: true,
            currencyCode: true,
            altegioOpeningBalanceDate: true,
            altegioMonthlyTurnoverManual: true,
            fopAnnualTurnoverLimitKop: true,
          },
        });
        accRows = partial.map((a) => ({
          ...a,
          ytdIncomingManualKop: null,
          ytdIncomingManualThroughDate: null,
        }));
      } catch (fopErr2) {
        if (!isMissingFopTurnoverColumnError(fopErr2)) throw fopErr2;
        console.warn(
          "[bank/operations] Поля місяця/ліміту ФОП недоступні, лише дата точки відліку:",
          fopErr2 instanceof Error ? fopErr2.message : String(fopErr2),
        );
        const minimal = await prisma.bankAccount.findMany({
          where: { id: { in: pageAccountIds } },
          select: {
            id: true,
            currencyCode: true,
            altegioOpeningBalanceDate: true,
          },
        });
        accRows = minimal.map((a) => ({
          ...a,
          altegioMonthlyTurnoverManual: null,
          ytdIncomingManualKop: null,
          ytdIncomingManualThroughDate: null,
          fopAnnualTurnoverLimitKop: null,
        }));
      }
    }
    for (const a of accRows) {
      if (a.currencyCode !== 980) continue;
      fopConfigs.set(a.id, {
        anchorStart: a.altegioOpeningBalanceDate,
        monthlyTurnoverManual: a.altegioMonthlyTurnoverManual,
        ytdIncomingManualKop: a.ytdIncomingManualKop,
        ytdIncomingManualThroughDate: a.ytdIncomingManualThroughDate,
        annualLimitKop: a.fopAnnualTurnoverLimitKop,
      });
    }

    let fopMonthTurnoverByItemId = new Map<string, string>();
    let fopYtdByItemId = new Map<string, string>();
    let fopAnnualLimitByAccountId = new Map<string, string>();
    if (fopConfigs.size > 0) {
      try {
        const fop = await computeFopTurnoverForPage(
          pageItems.map((row) => ({ id: row.id, accountId: row.account.id, time: row.time })),
          fopConfigs,
          { operationsUpperBound: toDate }
        );
        fopMonthTurnoverByItemId = fop.monthTurnoverByItemId;
        fopYtdByItemId = fop.ytdTurnoverByItemId;
        fopAnnualLimitByAccountId = fop.annualLimitKopByAccountId;
      } catch (fopCalcErr) {
        console.warn(
          "[bank/operations] Розрахунок обороту ФОП пропущено:",
          fopCalcErr instanceof Error ? fopCalcErr.message : String(fopCalcErr)
        );
      }
    }

    const list = pageItems.map((i) => {
      const acc = i.account;
      const conn = acc.connection;
      const owner = conn.clientName ?? conn.name ?? "—";
      const accountLast4 =
        last4(acc.maskedPan ?? null) !== "—"
          ? last4(acc.maskedPan ?? null)
          : last4(acc.iban ?? null) !== "—"
            ? last4(acc.iban ?? null)
            : last4(acc.externalId ?? null);
      const freshAltegio = freshAltegioByAccountId.get(acc.id);
      return {
        id: i.id,
        time: i.time.toISOString(),
        amount: i.amount.toString(),
        balance: i.balance != null ? i.balance.toString() : null,
        description: i.description,
        comment: i.comment ?? null,
        counterName: i.counterName ?? null,
        owner,
        connectionId: conn.id,
        accountId: acc.id,
        accountLast4,
        currencyCode: acc.currencyCode ?? 980,
        altegioBalance:
          freshAltegio?.balance != null
            ? freshAltegio.balance.toString()
            : "altegioBalanceSnapshot" in i && i.altegioBalanceSnapshot != null
              ? i.altegioBalanceSnapshot.toString()
              : null,
        altegioAccountTitle:
          freshAltegio?.title ??
          ("altegioAccountTitleSnapshot" in i ? i.altegioAccountTitleSnapshot ?? null : null),
        altegioBalanceUpdatedAt:
          freshAltegio?.updatedAt != null
            ? freshAltegio.updatedAt.toISOString()
            : "altegioBalanceCapturedAt" in i
              ? i.altegioBalanceCapturedAt?.toISOString() ?? null
              : null,
        altegioSyncError:
          freshAltegio?.syncError ??
          ("altegioSyncErrorSnapshot" in i ? i.altegioSyncErrorSnapshot ?? null : null),
        altegioBalanceFromAnchor: balanceAfterByItemId.get(i.id) ?? null,
        altegioOpeningBalanceDate: openingDateIsoByAccountId.get(acc.id) ?? null,
        fopMonthTurnoverKop:
          (acc.currencyCode ?? 980) === 980 ? fopMonthTurnoverByItemId.get(i.id) ?? null : null,
        fopYtdTurnoverKop: (acc.currencyCode ?? 980) === 980 ? fopYtdByItemId.get(i.id) ?? null : null,
        fopAnnualLimitKop:
          (acc.currencyCode ?? 980) === 980
            ? fopAnnualLimitByAccountId.get(acc.id) ?? null
            : null,
        fopAnnualRemainingKop:
          (acc.currencyCode ?? 980) === 980 ? fopAnnualRemainingNowByAccountId.get(acc.id) ?? null : null,
      };
    });

    const lastItem = pageItems[pageItems.length - 1];
    const nextCursor = hasMore && lastItem ? `${lastItem.time.toISOString()}|${lastItem.id}` : null;

    return NextResponse.json(
      {
        ok: true,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        /** Мітка для перевірки деплою: ЗЛ у items = ліміт − YTD на цей момент (як футер), не на час операції. */
        fopZlAsOf: fopZlAsOf.toISOString(),
        items: list,
        hasMore,
        nextCursor,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    console.error("[bank/operations] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження операцій" },
      { status: 500 }
    );
  }
}
