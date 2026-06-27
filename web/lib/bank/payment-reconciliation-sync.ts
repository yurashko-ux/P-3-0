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

function addKyivDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  utcMidday.setUTCDate(utcMidday.getUTCDate() + days);
  return kyivYmdFromDate(utcMidday);
}

async function findMonobankStatementItem(params: {
  token: string;
  accountExternalId: string;
  statementExternalId: string;
  kyivDay: string;
}) {
  const days = [params.kyivDay, addKyivDaysYmd(params.kyivDay, -1), addKyivDaysYmd(params.kyivDay, 1)];
  const seen = new Set<string>();

  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);

    const { from, to } = kyivDayUnixRange(day);
    const items = await fetchStatement(params.token, params.accountExternalId, from, to);
    const remote = items.find((item) => String(item.id) === params.statementExternalId);
    if (remote) {
      return { remote, kyivDay: day };
    }
  }

  return { remote: null as null, kyivDay: params.kyivDay };
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
    const kyivDay = kyivYmdFromDate(statement.time);
    const { remote, kyivDay: foundDay } = await findMonobankStatementItem({
      token: statement.account.connection.token,
      accountExternalId: statement.account.externalId,
      statementExternalId: statement.externalId,
      kyivDay,
    });

    if (!remote) {
      console.warn("[bank/payment-reconcile-sync] Hold refresh: операцію не знайдено у виписці monobank", {
        bankStatementItemId,
        externalId: statement.externalId,
        kyivDay,
        searchedDays: [kyivDay, addKyivDaysYmd(kyivDay, -1), addKyivDaysYmd(kyivDay, 1)],
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
      kyivDay: foundDay,
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
  /** Платежі, у яких hold змінився true → false під час синку */
  holdFinalizedIds: string[];
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
  const holdFinalizedIds: string[] = [];
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

        const externalId = String(item.id);
        const existing = await prisma.bankStatementItem.findUnique({
          where: {
            accountId_externalId: { accountId: account.id, externalId },
          },
          select: { id: true, hold: true },
        });
        const nextHold = item.hold ?? false;

        const upserted = await prisma.bankStatementItem.upsert({
          where: {
            accountId_externalId: { accountId: account.id, externalId },
          },
          create: {
            accountId: account.id,
            externalId,
            time: new Date((item.time || 0) * 1000),
            description: item.description ?? "",
            comment: item.comment?.trim() || null,
            counterName: item.counterName?.trim() || null,
            amount,
            balance: item.balance != null ? BigInt(item.balance) : null,
            hold: nextHold,
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
            hold: nextHold,
            mcc: item.mcc ?? null,
            operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
          },
          select: { id: true },
        });

        if (existing?.hold === true && nextHold === false) {
          holdFinalizedIds.push(upserted.id);
        }
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
    holdFinalized: holdFinalizedIds.length,
    errors: errors.length,
  });

  return { checkedAccounts, skippedByRateLimit, saved, holdFinalizedIds, errors };
}

/** Оновлює застарілі hold:true з monobank API (якщо webhook пропустив фіналізацію). */
export async function refreshStaleHoldBankStatements(params: { lookbackDays?: number; maxItems?: number } = {}): Promise<{
  checked: number;
  refreshed: number;
  holdFinalizedIds: string[];
  errors: number;
}> {
  const lookbackDays = Math.max(1, params.lookbackDays ?? 7);
  const maxItems = Math.max(1, params.maxItems ?? 30);
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - lookbackDays);

  const staleItems = await prisma.bankStatementItem.findMany({
    where: {
      hold: true,
      amount: { lt: 0 },
      time: { gte: fromDate },
      account: { includeInOperationsTable: true },
    },
    select: { id: true },
    orderBy: { time: "desc" },
    take: maxItems,
  });

  const holdFinalizedIds: string[] = [];
  let refreshed = 0;
  let errors = 0;

  for (const item of staleItems) {
    const result = await refreshBankStatementHoldFromMonobank(item.id);
    if (result.refreshed) {
      refreshed += 1;
      holdFinalizedIds.push(item.id);
    } else if (result.reason === "error") {
      errors += 1;
    }
  }

  console.log("[bank/payment-reconcile-sync] Оновлення застарілих hold завершено", {
    checked: staleItems.length,
    refreshed,
    errors,
  });

  return { checked: staleItems.length, refreshed, holdFinalizedIds, errors };
}
