import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { fetchStatement } from "@/lib/bank/monobank";
import { ALTEGIO_FINANCE_SYNC_START_DATE } from "@/lib/altegio/finance-transactions-sync";

const MONOBANK_STATEMENT_RATE_LIMIT_SEC = 60;

export type RefreshBankStatementHoldResult = {
  hold: boolean;
  refreshed: boolean;
  reason?: "not_found" | "already_final" | "still_hold" | "updated" | "api_miss" | "error";
};

function kyivYmdFromDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function kyivDayUnixRange(ymd: string): { from: number; to: number } {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  const from = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0, 0));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return {
    from: Math.floor(from.getTime() / 1000),
    to: Math.floor(to.getTime() / 1000),
  };
}

/** Оновлює hold з monobank API, якщо в БД застарілий hold:true. */
export async function refreshBankStatementHoldFromMonobank(
  bankStatementItemId: string,
): Promise<RefreshBankStatementHoldResult> {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    include: {
      account: {
        select: {
          externalId: true,
          connection: { select: { token: true } },
        },
      },
    },
  });

  if (!statement) {
    return { hold: true, refreshed: false, reason: "not_found" };
  }
  if (!statement.hold) {
    return { hold: false, refreshed: false, reason: "already_final" };
  }

  try {
    const { from, to } = kyivDayUnixRange(kyivYmdFromDate(statement.time));
    const items = await fetchStatement(
      statement.account.connection.token,
      statement.account.externalId,
      from,
      to,
    );
    const remote = items.find((item) => String(item.id) === statement.externalId);

    if (!remote) {
      console.warn("[bank/payment-reconcile-sync] Hold refresh: операцію не знайдено у виписці monobank", {
        bankStatementItemId,
        externalId: statement.externalId,
        kyivDay: kyivYmdFromDate(statement.time),
      });
      return { hold: true, refreshed: false, reason: "api_miss" };
    }

    const remoteHold = remote.hold ?? false;
    if (remoteHold) {
      return { hold: true, refreshed: false, reason: "still_hold" };
    }

    await prisma.bankStatementItem.update({
      where: { id: bankStatementItemId },
      data: {
        hold: false,
        time: remote.time ? new Date(remote.time * 1000) : statement.time,
        description: remote.description ?? statement.description,
        comment: remote.comment?.trim() || statement.comment,
        counterName: remote.counterName?.trim() || statement.counterName,
        amount: BigInt(remote.amount ?? statement.amount),
        balance: remote.balance != null ? BigInt(remote.balance) : statement.balance,
        mcc: remote.mcc ?? statement.mcc,
        operationAmount: remote.operationAmount ? (remote.operationAmount as object) : statement.operationAmount,
      },
    });

    console.log("[bank/payment-reconcile-sync] Hold refresh: фіналізовано з monobank API", {
      bankStatementItemId,
      externalId: statement.externalId,
    });
    return { hold: false, refreshed: true, reason: "updated" };
  } catch (error) {
    console.warn("[bank/payment-reconcile-sync] Hold refresh: помилка запиту monobank", {
      bankStatementItemId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { hold: true, refreshed: false, reason: "error" };
  }
}

export type SyncBankOutgoingStatementsResult = {
  checkedAccounts: number;
  skippedByRateLimit: number;
  saved: number;
  errors: Array<{ accountId: string; error: string }>;
};

function dateFromInput(value?: string): Date {
  const fallback = new Date(`${ALTEGIO_FINANCE_SYNC_START_DATE}T00:00:00.000Z`);
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function canUseConnectionStatementLimit(connectionId: string): Promise<boolean> {
  const key = `bank:monobank:statement:last:connection:${connectionId}`;
  const lastStr = await kvRead.getRaw(key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (lastStr) {
    const last = Number(lastStr);
    if (Number.isFinite(last) && nowSec - last < MONOBANK_STATEMENT_RATE_LIMIT_SEC) {
      return false;
    }
  }
  await kvWrite.setRaw(key, String(nowSec));
  return true;
}

export async function syncBankOutgoingStatementsForReconciliation(params: {
  from?: string;
  to?: string;
  maxAccounts?: number | null;
  accountType?: string;
  requireAltegioAccount?: boolean;
} = {}): Promise<SyncBankOutgoingStatementsResult> {
  const fromDate = dateFromInput(params.from);
  const toDate = params.to ? new Date(params.to) : new Date();
  const fromUnix = Math.floor(fromDate.getTime() / 1000);
  const toUnix = Math.floor(toDate.getTime() / 1000);
  const maxAccounts =
    params.maxAccounts == null ? null : Math.max(1, params.maxAccounts);

  const accounts = await prisma.bankAccount.findMany({
    where: {
      includeInOperationsTable: true,
      currencyCode: 980,
      ...(params.accountType ? { type: params.accountType } : {}),
      ...(params.requireAltegioAccount === false ? {} : { altegioAccountId: { not: null } }),
    },
    select: {
      id: true,
      externalId: true,
      connectionId: true,
      connection: { select: { token: true } },
    },
    ...(maxAccounts ? { take: maxAccounts } : {}),
    orderBy: { createdAt: "asc" },
  });

  let checkedAccounts = 0;
  let skippedByRateLimit = 0;
  let saved = 0;
  const errors: Array<{ accountId: string; error: string }> = [];

  for (const account of accounts) {
    checkedAccounts += 1;
    const allowed = await canUseConnectionStatementLimit(account.connectionId).catch(() => true);
    if (!allowed) {
      skippedByRateLimit += 1;
      continue;
    }

    try {
      const items = await fetchStatement(account.connection.token, account.externalId, fromUnix, toUnix);
      for (const item of items) {
        const amount = BigInt(item.amount ?? 0);
        if (amount >= 0n) continue;
        await prisma.bankStatementItem.upsert({
          where: {
            accountId_externalId: { accountId: account.id, externalId: String(item.id) },
          },
          create: {
            accountId: account.id,
            externalId: String(item.id),
            time: new Date((item.time || 0) * 1000),
            description: item.description ?? "",
            comment: item.comment?.trim() || null,
            counterName: item.counterName?.trim() || null,
            amount,
            balance: item.balance != null ? BigInt(item.balance) : null,
            hold: item.hold ?? false,
            mcc: item.mcc ?? null,
            operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
          },
          update: {
            time: new Date((item.time || 0) * 1000),
            description: item.description ?? "",
            comment: item.comment?.trim() || null,
            counterName: item.counterName?.trim() || null,
            amount,
            balance: item.balance != null ? BigInt(item.balance) : null,
            hold: item.hold ?? false,
            mcc: item.mcc ?? null,
            operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
          },
        });
        saved += 1;
      }
    } catch (error) {
      errors.push({
        accountId: account.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("[bank/payment-reconcile-sync] Safety-sync банківської виписки завершено", {
    checkedAccounts,
    skippedByRateLimit,
    saved,
    errors: errors.length,
  });

  return { checkedAccounts, skippedByRateLimit, saved, errors };
}
