// web/lib/bank/altegio-opening-anchor.ts
// Оцінка балансу Altegio після кожної операції: B₀ — на початок дня Europe/Kyiv дати відліку;
// до B₀ додаються операції Monobank після цього моменту.

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

export type PageItemForAnchor = { id: string; accountId: string; time: Date };

/**
 * Для кожного рядка виписки (id) повертає оціночний баланс Altegio в копійках після цієї операції:
 * ручний B₀ (початок дня Europe/Kyiv дати відліку) + сума amount операцій Monobank
 * строго після моменту відліку до поточного рядка включно.
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
    const anchorStartUtc = startOfKyivCalendarDay(openingKyivYmd);
    const b0 = acc.altegioOpeningBalanceManual;
    openingDateIsoByAccountId.set(accountId, openingDayStart.toISOString());

    const pageForAcc = pageItems.filter((p) => p.accountId === accountId);
    for (const p of pageForAcc) {
      if (p.time === anchorStartUtc) {
        balanceAfterByItemId.set(p.id, b0.toString());
      }
    }

    const chain = await prisma.bankStatementItem.findMany({
      where: {
        accountId,
        time: { gt: anchorStartUtc, lte: requestToDate },
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
 * Баланс Altegio для футера: знімок з БД, інакше оцінка B₀ + Monobank після початку дня Europe/Kyiv відліку.
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
    const anchorStartUtc = startOfKyivCalendarDay(openingKyivYmd);
    const agg = await prisma.bankStatementItem.aggregate({
      where: {
        accountId: acc.id,
        time: { gt: anchorStartUtc, lte: asOf },
        account: { includeInOperationsTable: true },
      },
      _sum: { amount: true },
    });
    const delta = agg._sum.amount ?? 0n;
    return { kop: acc.altegioOpeningBalanceManual + delta, isEstimate: true };
  }
  return { kop: null, isEstimate: false };
}
