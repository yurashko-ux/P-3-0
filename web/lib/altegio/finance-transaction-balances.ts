import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts, fetchZReportAccountAmountsById } from "./accounts";
import { ALTEGIO_ENV } from "./env";

type RecalculateBalancesResult = {
  companyId: string;
  accounts: number;
  transactionsUpdated: number;
};

type RawRecord = Record<string, unknown>;

function resolveCompanyId(): string {
  const companyId = process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для перерахунку залишків рахунків Altegio");
  }
  return companyId;
}

function kyivYmd(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function toMoneyNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toKopiykas(value: unknown): bigint | null {
  const money = toMoneyNumber(value);
  return money == null ? null : BigInt(Math.round(money * 100));
}

function collectPaymentMethodRows(value: unknown, out: RawRecord[] = []): RawRecord[] {
  const record = asRecord(value);
  if (!record) return out;

  for (const key of ["payment_methods", "paymentMethods", "payment_method", "paymentMethod"]) {
    const direct = record[key];
    if (Array.isArray(direct)) {
      out.push(...direct.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null));
    } else {
      const directRecord = asRecord(direct);
      if (directRecord) out.push(directRecord);
    }
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectPaymentMethodRows(nested, out);
  }

  return out;
}

function paymentMethodAccountId(method: RawRecord): string | null {
  const account = asRecord(method.account);
  const value =
    method.account_id ??
    method.accountId ??
    method.cashbox_id ??
    method.cashboxId ??
    method.cash_id ??
    method.cashId ??
    account?.id;
  return value == null ? null : String(value);
}

function paymentMethodBalance(method: RawRecord): bigint | null {
  const account = asRecord(method.account);
  return (
    toKopiykas(method.balance) ??
    toKopiykas(method.current_balance) ??
    toKopiykas(method.currentBalance) ??
    toKopiykas(method.account_balance) ??
    toKopiykas(method.accountBalance) ??
    toKopiykas(account?.balance)
  );
}

export function extractPaymentMethodBalanceKopiykas(raw: unknown, accountId?: string | null): bigint | null {
  const methods = collectPaymentMethodRows(raw);
  if (methods.length === 0) return null;

  const targetAccountId = String(accountId || "").trim();
  if (targetAccountId) {
    for (const method of methods) {
      if (paymentMethodAccountId(method) !== targetAccountId) continue;
      const balance = paymentMethodBalance(method);
      if (balance != null) return balance;
    }
  }

  if (methods.length === 1) {
    return paymentMethodBalance(methods[0]);
  }

  return null;
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
  const accountIdsWithoutBalance = accounts
    .filter((account) => account.balanceKopiykas == null)
    .map((account) => account.id);
  const zReportBalances = accountIdsWithoutBalance.length > 0
    ? await fetchZReportAccountAmountsById(companyId, kyivYmd()).catch((error) => {
        console.warn(
          "[altegio/finance-balances] Не вдалося отримати z_report для залишків рахунків:",
          error instanceof Error ? error.message : String(error),
        );
        return new Map<string, bigint>();
      })
    : new Map<string, bigint>();
  let transactionsUpdated = 0;
  let accountsProcessed = 0;

  for (const account of accounts) {
    if (requestedAccountIds.size > 0 && !requestedAccountIds.has(account.id)) continue;
    const currentBalance = account.balanceKopiykas ?? zReportBalances.get(account.id) ?? null;

    accountsProcessed += 1;
    let balanceAfter = currentBalance;
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
        rawData: true,
      },
    });

    for (const transaction of transactions) {
      const paymentMethodBalanceAfter = extractPaymentMethodBalanceKopiykas(transaction.rawData, account.id);
      if (paymentMethodBalanceAfter != null) {
        if (transaction.accountBalanceAfterKopiykas !== paymentMethodBalanceAfter) {
          await (prisma as any).altegioFinanceTransaction.update({
            where: { id: transaction.id },
            data: { accountBalanceAfterKopiykas: paymentMethodBalanceAfter },
          });
          transactionsUpdated += 1;
        }
        balanceAfter = paymentMethodBalanceAfter - BigInt(transaction.amountKopiykas);
        continue;
      }

      if (balanceAfter == null) continue;

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
