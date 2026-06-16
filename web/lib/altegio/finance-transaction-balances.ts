import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "./accounts";
import { ALTEGIO_ENV } from "./env";

type RecalculateBalancesResult = {
  companyId: string;
  accounts: number;
  transactionsUpdated: number;
};

function resolveCompanyId(): string {
  const companyId = process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для перерахунку залишків рахунків Altegio");
  }
  return companyId;
}

export async function recalculateAltegioFinanceTransactionBalances(params: {
  companyId?: string;
  accountIds?: Array<string | null | undefined>;
} = {}): Promise<RecalculateBalancesResult> {
  const companyId = params.companyId || resolveCompanyId();
  const requestedAccountIds = new Set(
    (params.accountIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const accounts = await fetchAltegioAccounts(companyId);
  let transactionsUpdated = 0;
  let accountsProcessed = 0;

  for (const account of accounts) {
    if (requestedAccountIds.size > 0 && !requestedAccountIds.has(account.id)) continue;
    if (account.balanceKopiykas == null) continue;

    accountsProcessed += 1;
    let balanceAfter = account.balanceKopiykas;
    const transactions = await (prisma as any).altegioFinanceTransaction.findMany({
      where: {
        companyId,
        accountId: account.id,
        deletedInAltegio: false,
      },
      orderBy: [
        { operationDate: "desc" },
        { createdAt: "desc" },
        { altegioId: "desc" },
      ],
      select: {
        id: true,
        amountKopiykas: true,
        accountBalanceAfterKopiykas: true,
      },
    });

    for (const transaction of transactions) {
      if (transaction.accountBalanceAfterKopiykas !== balanceAfter) {
        await (prisma as any).altegioFinanceTransaction.update({
          where: { id: transaction.id },
          data: { accountBalanceAfterKopiykas: balanceAfter },
        });
        transactionsUpdated += 1;
      }
      balanceAfter -= BigInt(transaction.amountKopiykas);
    }
  }

  console.log("[altegio/finance-balances] Перераховано залишки після операцій", {
    companyId,
    accountsProcessed,
    transactionsUpdated,
  });

  return { companyId, accounts: accountsProcessed, transactionsUpdated };
}
