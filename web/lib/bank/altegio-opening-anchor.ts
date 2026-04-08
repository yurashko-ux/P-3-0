// web/lib/bank/altegio-opening-anchor.ts
// Оцінка балансу Altegio після кожної операції: B₀ — станом на кінець календарного дня UTC дати відліку;
// до B₀ додаються лише операції Monobank після цього дня (рухи того ж дня вже «вшиті» в B₀).

import { prisma } from "@/lib/prisma";
import { endOfUtcCalendarDay } from "@/lib/bank/fop-turnover";

const MAX_STATEMENT_ROWS_FOR_ANCHOR = 25_000;

export type PageItemForAnchor = { id: string; accountId: string; time: Date };

/**
 * Для кожного рядка виписки (id) повертає оціночний баланс Altegio в копійках після цієї операції:
 * ручний B₀ (кінець календарного дня UTC дати відліку) + сума amount операцій Monobank
 * строго після кінця того дня до поточного рядка включно.
 * Операції в день відліку (UTC) показують B₀ без додавання monobank — вони вже враховані в знімку.
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
    const anchorEndUtc = endOfUtcCalendarDay(openingDayStart);
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
 * Баланс Altegio для футера: знімок з БД, інакше оцінка B₀ + Monobank після кінця дня UTC відліку.
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
    const anchorEndUtc = endOfUtcCalendarDay(acc.altegioOpeningBalanceDate);
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
