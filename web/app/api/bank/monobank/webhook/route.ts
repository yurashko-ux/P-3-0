// web/app/api/bank/monobank/webhook/route.ts
// Webhook monobank: GET — валідація (200), POST — подія StatementItem

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Валідація URL: monobank надсилає GET — потрібно повернути 200 */
export async function GET() {
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
      console.warn("[bank/monobank/webhook] Рахунок не знайдено:", accountExternalId);
      return new NextResponse(null, { status: 200 });
    }

    const time = item.time != null ? new Date(item.time * 1000) : new Date();
    const amount = BigInt(item.amount ?? 0);
    const balance = item.balance != null ? BigInt(item.balance) : null;

    await prisma.bankStatementItem.upsert({
      where: {
        accountId_externalId: { accountId: bankAccount.id, externalId },
      },
      create: {
        accountId: bankAccount.id,
        externalId,
        time,
        description: item.description ?? "",
        amount,
        balance,
        hold: item.hold ?? false,
        mcc: item.mcc ?? null,
        operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
      },
      update: {
        time,
        description: item.description ?? "",
        amount,
        balance,
        hold: item.hold ?? false,
        mcc: item.mcc ?? null,
        operationAmount: item.operationAmount ? (item.operationAmount as object) : null,
      },
    });

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("[bank/monobank/webhook] Помилка:", error);
    return new NextResponse(null, { status: 200 });
  }
}
