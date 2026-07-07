// Лічильники незведених банківських операцій за календарний день (Kyiv).

import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds } from "@/lib/direct-stats-config";

export type BankUnmatchedCounts = {
  incomingUnmatched: number;
  outgoingUnmatched: number;
};

export async function countBankUnmatchedForKyivDay(kyivDay: string): Promise<BankUnmatchedCounts> {
  const { startUtc, endUtc } = getKyivDayUtcBounds(kyivDay);

  const [incomingUnmatched, outgoingUnmatched] = await Promise.all([
    prisma.bankStatementItem.count({
      where: {
        time: { gte: startUtc, lt: endUtc },
        amount: { gt: BigInt(0) },
        altegioIncomingMatch: null,
        altegioDepositMatch: null,
        account: { includeInOperationsTable: true },
      },
    }),
    prisma.bankStatementItem.count({
      where: {
        time: { gte: startUtc, lt: endUtc },
        amount: { lt: BigInt(0) },
        altegioPaymentMatch: null,
        account: { includeInOperationsTable: true },
      },
    }),
  ]);

  return { incomingUnmatched, outgoingUnmatched };
}
