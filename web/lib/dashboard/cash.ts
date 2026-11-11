// Блок «Залишки в касах» дашборду: той самий розрахунок, що в розділі Каса,
// але список рахунків — із власного довідника Kresco (finance_accounts), без API Altegio.

import { prisma } from "@/lib/prisma";
import { listCashBalances } from "@/lib/finance/cash-balances";
import type { DashboardCash } from "./types";

export async function loadDashboardCash(): Promise<DashboardCash> {
  const startedAt = Date.now();
  const [accounts, deposits] = await Promise.all([
    prisma.financeAccount.findMany({
      where: { archivedAt: null },
      select: { altegioAccountId: true, title: true },
    }),
    // Та сама цифра, що на плитці «Завдатки» в Касі: залишки клієнтів > 0 з останнього знімка.
    prisma.clientDepositAccount.aggregate({
      where: { altegioBalance: { gt: 0 } },
      _sum: { altegioBalance: true },
      _count: { _all: true },
    }),
  ]);

  // Розрахунок Каси поки тримається номера рахунку Altegio (він записаний в оплатах і документах).
  const known = accounts
    .filter((account) => account.altegioAccountId != null)
    .map((account) => ({ id: account.altegioAccountId as number, title: account.title }));
  const skipped = accounts.length - known.length;
  if (skipped > 0) {
    console.warn(`[dashboard/cash] Рахунків без номера Altegio: ${skipped} — у залишки не потрапили`);
  }

  const tiles = known.length > 0 ? await listCashBalances(known) : [];
  console.log(`[dashboard/cash] Залишки: ${tiles.length} рахунків за ${Date.now() - startedAt} мс`);

  return {
    ok: true,
    accounts: tiles.map((tile) => ({
      title: tile.title,
      cash: tile.cash,
      currency: tile.currency,
      balance: tile.currency === "UAH" ? tile.balanceUah : tile.balanceFx,
      openingPending: tile.openingPending,
      variance: tile.variance,
    })),
    deposits: {
      balance: Math.round((Number(deposits._sum.altegioBalance) || 0) * 100) / 100,
      clients: deposits._count._all,
    },
  };
}
