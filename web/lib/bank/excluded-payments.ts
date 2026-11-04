// Виключені (чужі) платежі: позначка paymentsHiddenAt на BankStatementItem.
// Такі платежі не показуємо в Банку й Платежах і віднімаємо від балансу рахунку,
// бо баланс monobank їх містить. Синхронізація їх не повертає — рядок лишається в базі.

import { prisma } from "@/lib/prisma";

/** Сума виключених платежів по рахунках (копійки, зі знаком). Один groupBy. */
export async function excludedAmountKopByAccount(accountIds?: string[]): Promise<Map<string, bigint>> {
  const rows = await prisma.bankStatementItem.groupBy({
    by: ["accountId"],
    where: {
      paymentsHiddenAt: { not: null },
      ...(accountIds && accountIds.length > 0 ? { accountId: { in: accountIds } } : {}),
    },
    _sum: { amount: true },
  });
  return new Map(rows.map((row) => [row.accountId, row._sum.amount ?? BigInt(0)]));
}

/** Баланс рахунку без виключених платежів. */
export function balanceWithoutExcluded(balance: bigint, accountId: string, excluded: Map<string, bigint>): bigint {
  return balance - (excluded.get(accountId) ?? BigInt(0));
}
