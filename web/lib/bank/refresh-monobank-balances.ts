import { fetchClientInfo } from "@/lib/bank/monobank";
import { prisma } from "@/lib/prisma";

export type MonobankBalanceRefreshResult = {
  connectionId: string;
  clientName: string;
  updated: number;
  error: string | null;
};

/** Поточні баланси всіх рахунків одного підключення з Monobank client-info. */
export async function refreshMonobankBalancesForConnection(params: {
  connectionId: string;
  token: string;
  expectedExternalId?: string;
}): Promise<number> {
  const clientInfo = await fetchClientInfo(params.token);
  const liveAccounts = clientInfo.accounts ?? [];
  if (
    params.expectedExternalId
    && !liveAccounts.some((account) => String(account.id) === params.expectedExternalId)
  ) {
    throw new Error("Monobank client-info не повернув вибраний рахунок");
  }

  const refreshedAt = new Date();
  const updates = await prisma.$transaction(
    liveAccounts.map((account) =>
      prisma.bankAccount.updateMany({
        where: {
          connectionId: params.connectionId,
          externalId: String(account.id),
        },
        data: {
          balance: BigInt(account.balance ?? 0),
          balanceUpdatedAt: refreshedAt,
        },
      }),
    ),
  );

  const updated = updates.reduce((sum, result) => sum + result.count, 0);
  console.log("[bank/monobank-balances] Баланси оновлено", {
    connectionId: params.connectionId,
    received: liveAccounts.length,
    updated,
  });
  return updated;
}

/** Нічне оновлення балансів усіх підключених рахунків. */
export async function refreshAllMonobankAccountBalances(): Promise<MonobankBalanceRefreshResult[]> {
  const connections = await prisma.bankConnection.findMany({
    where: { provider: "monobank" },
    select: {
      id: true,
      token: true,
      clientName: true,
      name: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const results: MonobankBalanceRefreshResult[] = [];
  for (const connection of connections) {
    const clientName = connection.clientName || connection.name || "Monobank";
    try {
      const updated = await refreshMonobankBalancesForConnection({
        connectionId: connection.id,
        token: connection.token,
      });
      results.push({ connectionId: connection.id, clientName, updated, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Помилка оновлення балансу";
      console.warn("[bank/monobank-balances] Підключення пропущено", {
        connectionId: connection.id,
        clientName,
        error: message,
      });
      results.push({ connectionId: connection.id, clientName, updated: 0, error: message });
    }
  }

  return results;
}
