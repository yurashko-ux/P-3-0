import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { fetchStatement } from "@/lib/bank/monobank";
import { ALTEGIO_FINANCE_SYNC_START_DATE } from "@/lib/altegio/finance-transactions-sync";

const MONOBANK_STATEMENT_RATE_LIMIT_SEC = 60;

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
  maxAccounts?: number;
} = {}): Promise<SyncBankOutgoingStatementsResult> {
  const fromDate = dateFromInput(params.from);
  const toDate = params.to ? new Date(params.to) : new Date();
  const fromUnix = Math.floor(fromDate.getTime() / 1000);
  const toUnix = Math.floor(toDate.getTime() / 1000);
  const maxAccounts = Math.max(1, params.maxAccounts ?? 5);

  const accounts = await prisma.bankAccount.findMany({
    where: {
      includeInOperationsTable: true,
      currencyCode: 980,
      altegioAccountId: { not: null },
    },
    select: {
      id: true,
      externalId: true,
      connectionId: true,
      connection: { select: { token: true } },
    },
    take: maxAccounts,
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
