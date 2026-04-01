// web/app/api/bank/monobank/webhook/route.ts
// Webhook monobank: GET — валідація (200), POST — подія StatementItem

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import { shouldSyncAltegioForBankAccount, syncAltegioBalanceForBankAccount } from "@/lib/altegio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Валідація URL: monobank надсилає GET — потрібно повернути 200. Логуємо, щоб у Vercel було видно, чи валідація була. */
export async function GET() {
  console.log("[bank/monobank/webhook] GET валідація від Monobank:", new Date().toISOString());
  return new NextResponse(null, { status: 200 });
}

/** Подія StatementItem: { type: "StatementItem", data: { account, statementItem } } */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const type = (body as { type?: string }).type;
    const data = (body as { data?: { account?: string; statementItem?: Record<string, unknown> } }).data;

    console.log("[bank/monobank/webhook] Отримано:", {
      timestamp: new Date().toISOString(),
      type,
      account: data?.account ?? null,
    });

    // Лог в KV для діагностики (без чутливих даних)
    try {
      const entry = {
        receivedAt: new Date().toISOString(),
        type,
        account: data?.account ?? null,
        statementId: data?.statementItem ? (data.statementItem as { id?: string }).id : null,
      };
      const payload = JSON.stringify(entry);
      await kvWrite.lpush("bank:monobank:webhook:log", payload);
      await kvWrite.ltrim("bank:monobank:webhook:log", 0, 49);
    } catch (err) {
      console.warn("[bank/monobank/webhook] Помилка запису в KV:", err);
    }

    if (type !== "StatementItem" || !data?.account || !data?.statementItem) {
      return new NextResponse(null, { status: 200 });
    }

    const accountExternalId = String(data.account);
    const item = data.statementItem as {
      id?: string;
      time?: number;
      description?: string;
      comment?: string;
      counterName?: string;
      amount?: number;
      balance?: number;
      hold?: boolean;
      mcc?: number;
      operationAmount?: unknown;
    };

    const externalId = item?.id != null ? String(item.id) : null;
    if (!externalId) {
      return new NextResponse(null, { status: 200 });
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: { externalId: accountExternalId },
    });
    if (!bankAccount) {
      const knownIds = await prisma.bankAccount.findMany({
        select: { externalId: true },
        take: 20,
      });
      console.warn("[bank/monobank/webhook] Рахунок не знайдено:", accountExternalId, "| відомі externalId:", knownIds.map((a) => a.externalId));
      return new NextResponse(null, { status: 200 });
    }

    const time = item.time != null ? new Date(item.time * 1000) : new Date();
    const amount = BigInt(item.amount ?? 0);
    const balance = item.balance != null ? BigInt(item.balance) : null;
    const existingStatement = await prisma.bankStatementItem.findUnique({
      where: {
        accountId_externalId: { accountId: bankAccount.id, externalId },
      },
      select: { id: true },
    });

    const statement = await prisma.bankStatementItem.upsert({
      where: {
        accountId_externalId: { accountId: bankAccount.id, externalId },
      },
      create: {
        accountId: bankAccount.id,
        externalId,
        time,
        description: item.description ?? "",
        comment: item.comment?.trim() || null,
        counterName: item.counterName?.trim() || null,
        amount,
        balance,
        hold: item.hold ?? false,
        mcc: item.mcc ?? null,
        operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
      },
      update: {
        time,
        description: item.description ?? "",
        comment: item.comment?.trim() || null,
        counterName: item.counterName?.trim() || null,
        amount,
        balance,
        hold: item.hold ?? false,
        mcc: item.mcc ?? null,
        operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
      },
    });

    if (balance != null) {
      await prisma.bankAccount.update({
        where: { id: bankAccount.id },
        data: { balance },
      });
    }

    if (!existingStatement && shouldSyncAltegioForBankAccount({ currencyCode: bankAccount.currencyCode })) {
      try {
        const syncResult = await syncAltegioBalanceForBankAccount(bankAccount.id);
        const snapshotData: any = {
          altegioBalanceSnapshot:
            syncResult.status === "success" ? BigInt(syncResult.altegioBalance) : null,
          altegioAccountTitleSnapshot:
            syncResult.status === "success" || syncResult.status === "warning"
              ? syncResult.altegioAccountTitle ?? null
              : null,
          altegioSyncErrorSnapshot: syncResult.status === "warning" ? syncResult.reason : null,
          altegioBalanceCapturedAt: new Date(),
        };
        await prisma.bankStatementItem.update({
          where: { id: statement.id },
          data: snapshotData,
        });

        console.log("[bank/monobank/webhook] Синхронізація altegio-балансу:", {
          bankAccountId: bankAccount.id,
          externalId,
          statementId: statement.id,
          syncResult,
        });
      } catch (syncError) {
        const snapshotErrorData: any = {
          altegioBalanceSnapshot: null,
          altegioAccountTitleSnapshot: null,
          altegioSyncErrorSnapshot:
            syncError instanceof Error ? syncError.message : String(syncError),
          altegioBalanceCapturedAt: new Date(),
        };
        await prisma.bankStatementItem.update({
          where: { id: statement.id },
          data: snapshotErrorData,
        });

        console.warn("[bank/monobank/webhook] Помилка синхронізації altegio-балансу:", {
          bankAccountId: bankAccount.id,
          externalId,
          statementId: statement.id,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    } else if (existingStatement) {
      console.log("[bank/monobank/webhook] Altegio-snapshot пропущено для вже існуючої операції:", {
        bankAccountId: bankAccount.id,
        externalId,
        statementId: existingStatement.id,
      });
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("[bank/monobank/webhook] Помилка:", error);
    return new NextResponse(null, { status: 200 });
  }
}
