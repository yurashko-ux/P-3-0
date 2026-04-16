// web/lib/bank/altegio-opening-anchor.ts
// Оцінка балансу Altegio після кожної операції: B₀ — станом на кінець дня Europe/Kyiv дати відліку;
// до B₀ додаються операції Monobank після цього дня.

import { prisma } from "@/lib/prisma";

const MAX_STATEMENT_ROWS_FOR_ANCHOR = 25_000;
const BANK_ANCHOR_KYIV_TZ = "Europe/Kyiv";
const bankAnchorKyivYmdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANK_ANCHOR_KYIV_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function bankAnchorKyivCalendarYmd(d: Date): string {
  return bankAnchorKyivYmdFmt.format(d);
}

/** Перший момент календарного дня ymd у Europe/Kyiv (UTC Date). */
function startOfKyivCalendarDay(ymd: string): Date {
  const parts = ymd.split("-").map(Number);
  const y = parts[0]!;
  const mo = parts[1]!;
  const day = parts[2]!;
  let lo = Date.UTC(y, mo - 1, day - 1, 0, 0, 0, 0);
  let hi = Date.UTC(y, mo - 1, day + 2, 0, 0, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const lab = bankAnchorKyivCalendarYmd(new Date(mid));
    if (lab < ymd) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

/** Кінець календарного дня ymd у Europe/Kyiv (UTC Date). */
function endOfKyivCalendarDay(ymd: string): Date {
  const start = startOfKyivCalendarDay(ymd);
  const [y, m, d] = ymd.split("-").map(Number);
  const nextNoonUtc = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0, 0));
  const y2 = nextNoonUtc.getUTCFullYear();
  const m2 = String(nextNoonUtc.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(nextNoonUtc.getUTCDate()).padStart(2, "0");
  const nextStart = startOfKyivCalendarDay(`${y2}-${m2}-${d2}`);
  return new Date(nextStart.getTime() - 1);
}

export type PageItemForAnchor = { id: string; accountId: string; time: Date };

/**
 * Для кожного рядка виписки (id) повертає оціночний баланс Altegio в копійках після цієї операції:
 * ручний B₀ (кінець дня Europe/Kyiv дати відліку) + сума amount операцій Monobank
 * строго після цього дня до поточного рядка включно.
 */
export async function buildAltegioBalanceAfterTxnFromOpeningAnchor(
  pageItems: PageItemForAnchor[],
  requestToDate: Date
): Promise<{
  balanceAfterByItemId: Map<string, string>;
  /** ISO-мітка початку дня відліку (UTC), щоб показати в UI */
  openingDateIsoByAccountId: Map<string, string>;
}> {
  const balanceAfterByItemId = new Map<string, string>();
  const openingDateIsoByAccountId = new Map<string, string>();
  const accountIds = [...new Set(pageItems.map((p) => p.accountId))];

  for (const accountId of accountIds) {
    let acc: {
      currencyCode: number;
      altegioOpeningBalanceManual: bigint | null;
      altegioOpeningBalanceDate: Date | null;
    } | null;
    try {
      acc = await prisma.bankAccount.findUnique({
        where: { id: accountId },
        select: {
          currencyCode: true,
          altegioOpeningBalanceManual: true,
          altegioOpeningBalanceDate: true,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("altegioOpeningBalance")) {
        console.warn("[bank/opening-anchor] Колонки точки відліку недоступні в БД:", msg);
        continue;
      }
      throw e;
    }

    if (!acc?.altegioOpeningBalanceManual || !acc.altegioOpeningBalanceDate) continue;
    if (acc.currencyCode !== 980) continue;

    const openingDayStart = acc.altegioOpeningBalanceDate;
    const openingKyivYmd = bankAnchorKyivCalendarYmd(openingDayStart);
    const anchorEndUtc = endOfKyivCalendarDay(openingKyivYmd);
    const b0 = acc.altegioOpeningBalanceManual;
    openingDateIsoByAccountId.set(accountId, openingDayStart.toISOString());

    const pageForAcc = pageItems.filter((p) => p.accountId === accountId);
    for (const p of pageForAcc) {
      if (p.time <= anchorEndUtc) {
        balanceAfterByItemId.set(p.id, b0.toString());
      }
    }

    const chain = await prisma.bankStatementItem.findMany({
      where: {
        accountId,
        time: { gt: anchorEndUtc, lte: requestToDate },
        account: { includeInOperationsTable: true },
      },
      orderBy: [{ time: "asc" }, { id: "asc" }],
      take: MAX_STATEMENT_ROWS_FOR_ANCHOR + 1,
      select: { id: true, amount: true },
    });

    if (chain.length > MAX_STATEMENT_ROWS_FOR_ANCHOR) {
      console.warn(
        "[bank/opening-anchor] Пропуск оцінки для рахунку",
        accountId,
        ": більше",
        MAX_STATEMENT_ROWS_FOR_ANCHOR,
        "операцій після дня відліку — збільшіть ліміт або звузьте період у таблиці Банк."
      );
      continue;
    }

    let cum = b0;
    for (const row of chain) {
      cum += row.amount;
      balanceAfterByItemId.set(row.id, cum.toString());
    }
  }

  return { balanceAfterByItemId, openingDateIsoByAccountId };
}

/**
 * Баланс Altegio для футера: знімок з БД, інакше оцінка B₀ + Monobank після кінця дня Europe/Kyiv відліку.
 */
export async function computeAltegioBalanceKopForFooter(
  acc: {
    id: string;
    currencyCode: number;
    altegioBalance: bigint | null;
    altegioOpeningBalanceManual: bigint | null;
    altegioOpeningBalanceDate: Date | null;
  },
  asOf: Date
): Promise<{ kop: bigint | null; isEstimate: boolean }> {
  const cur = acc.currencyCode ?? 980;
  if (cur !== 980) {
    return { kop: acc.altegioBalance, isEstimate: false };
  }
  if (acc.altegioBalance != null) {
    return { kop: acc.altegioBalance, isEstimate: false };
  }
  if (acc.altegioOpeningBalanceManual != null && acc.altegioOpeningBalanceDate) {
    const openingKyivYmd = bankAnchorKyivCalendarYmd(acc.altegioOpeningBalanceDate);
    const anchorEndUtc = endOfKyivCalendarDay(openingKyivYmd);
    const agg = await prisma.bankStatementItem.aggregate({
      where: {
        accountId: acc.id,
        time: { gt: anchorEndUtc, lte: asOf },
        account: { includeInOperationsTable: true },
      },
      _sum: { amount: true },
    });
    const delta = agg._sum.amount ?? 0n;
    return { kop: acc.altegioOpeningBalanceManual + delta, isEstimate: true };
  }
  return { kop: null, isEstimate: false };
}
