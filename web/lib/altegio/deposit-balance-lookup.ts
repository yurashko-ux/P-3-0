// Клієнт-безпечний пошук балансу депозитного рахунку (дані з API depositBalances).

import { personNamesMatch } from "@/lib/bank/incoming-reconcile-matching";

export type DepositBalanceAccount = {
  depositId: number;
  clientId: number | null;
  clientName: string | null;
  depositTypeTitle: string | null;
  balance: number;
};

export type DepositBalancesPayload = {
  totalBalance: number;
  source: string;
  accounts: DepositBalanceAccount[];
};

function normalizeDepositTypeKey(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function depositTypeMatchesAccount(
  depositTypeTitle: string | null | undefined,
  accountTitle: string | null | undefined,
): boolean {
  const typeKey = normalizeDepositTypeKey(depositTypeTitle);
  const accountKey = normalizeDepositTypeKey(accountTitle);
  if (!typeKey || !accountKey) return false;
  if (typeKey === accountKey) return true;
  if (typeKey.includes(accountKey) || accountKey.includes(typeKey)) return true;
  return false;
}

export type DepositBalanceLookup = {
  lookup: (
    clientId: number | null | undefined,
    payerName: string | null | undefined,
    accountTitle: string | null | undefined,
  ) => number | null;
};

export function buildDepositBalanceLookup(
  payload: DepositBalancesPayload | null | undefined,
): DepositBalanceLookup {
  const accounts = payload?.accounts ?? [];
  const byClientId = new Map<number, DepositBalanceAccount[]>();
  const byClientName = new Map<string, DepositBalanceAccount[]>();

  for (const account of accounts) {
    if (account.clientId != null) {
      if (!byClientId.has(account.clientId)) byClientId.set(account.clientId, []);
      byClientId.get(account.clientId)!.push(account);
    }
    const nameKey = (account.clientName || "").trim().toLowerCase();
    if (nameKey) {
      if (!byClientName.has(nameKey)) byClientName.set(nameKey, []);
      byClientName.get(nameKey)!.push(account);
    }
  }

  function accountsByPayerName(payerName: string): DepositBalanceAccount[] {
    const normalizedName = payerName.trim();
    if (!normalizedName) return [];

    for (const [nameKey, list] of byClientName.entries()) {
      if (personNamesMatch(normalizedName, nameKey)) return list;
    }
    for (const account of accounts) {
      if (!account.clientName || !personNamesMatch(normalizedName, account.clientName)) continue;
      if (account.clientId != null && byClientId.has(account.clientId)) {
        return byClientId.get(account.clientId)!;
      }
      return [account];
    }
    return [];
  }

  function clientAccounts(
    clientId: number | null | undefined,
    payerName: string | null | undefined,
  ): DepositBalanceAccount[] {
    if (clientId != null && byClientId.has(clientId)) {
      return byClientId.get(clientId)!;
    }

    const byName = payerName?.trim() ? accountsByPayerName(payerName) : [];
    if (byName.length > 0) return byName;

    return [];
  }

  function lookup(
    clientId: number | null | undefined,
    payerName: string | null | undefined,
    accountTitle: string | null | undefined,
  ): number | null {
    const hasClientHint = clientId != null || Boolean(payerName?.trim());
    const list = clientAccounts(clientId, payerName);
    if (list.length === 0) return hasClientHint ? 0 : null;

    if (accountTitle?.trim()) {
      const matched = list.find((item) =>
        depositTypeMatchesAccount(item.depositTypeTitle, accountTitle),
      );
      if (matched != null && matched.balance > 0) return matched.balance;
    }

    const positiveSum = list
      .filter((item) => item.balance > 0)
      .reduce((sum, item) => sum + item.balance, 0);
    if (positiveSum > 0) return Math.round(positiveSum * 100) / 100;

    const totalSum = list.reduce((sum, item) => sum + item.balance, 0);
    return Math.round(totalSum * 100) / 100;
  }

  return { lookup };
}
