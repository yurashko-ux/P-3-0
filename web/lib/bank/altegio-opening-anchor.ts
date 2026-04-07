// web/lib/bank/altegio-opening-anchor.ts
// Оцінка балансу Altegio після кожної операції: B₀ (з Altegio на дату відліку) + сума рухів Monobank після цієї дати.

import { prisma } from "@/lib/prisma";

const MAX_STATEMENT_ROWS_FOR_ANCHOR = 25_000;

export type PageItemForAnchor = { id: string; accountId: string; time: Date };

/**
 * Для кожного рядка виписки (id) повертає оціночний баланс Altegio в копійках після цієї операції:
 * початковий ручний баланс на 00:00 UTC обраної дати + сума amount усіх операцій Monobank
 * з цієї ж миті (включно з ланцюжком за часом) до поточного рядка включно.
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

    const openingStart = acc.altegioOpeningBalanceDate;
    const b0 = acc.altegioOpeningBalanceManual;
    openingDateIsoByAccountId.set(accountId, openingStart.toISOString());

    const chain = await prisma.bankStatementItem.findMany({
      where: {
        accountId,
        time: { gte: openingStart, lte: requestToDate },
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
        "операцій від дати відліку — збільшіть ліміт або звузьте період у таблиці Банк."
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
