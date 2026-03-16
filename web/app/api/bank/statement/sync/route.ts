// web/app/api/bank/statement/sync/route.ts
// POST: підтягнути виписку з monobank API та зберегти в БД (обмеження 1 раз / 60 с на рахунок)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { fetchStatement } from "@/lib/bank/monobank";
import { kvRead, kvWrite } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_SEC = 60;

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const fromParam = typeof body.from === "string" ? body.from : "";
  const toParam = typeof body.to === "string" ? body.to : "";

  if (!accountId) {
    return NextResponse.json({ error: "accountId обов'язковий" }, { status: 400 });
  }

  let fromDate: Date;
  let toDate: Date;
  try {
    fromDate = fromParam ? new Date(fromParam) : new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    toDate = toParam ? new Date(toParam) : new Date();
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new Error("Невірний формат дати");
    }
  } catch {
    return NextResponse.json({ error: "Невірні параметри from/to" }, { status: 400 });
  }

  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { connection: true },
    });
    if (!account || !account.connection) {
      return NextResponse.json({ error: "Рахунок не знайдено" }, { status: 404 });
    }

    const rateLimitKey = `bank:monobank:statement:last:${accountId}`;
    const lastStr = await kvRead.getRaw(rateLimitKey);
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastStr) {
      const last = parseInt(lastStr, 10);
      if (!Number.isNaN(last) && nowSec - last < RATE_LIMIT_SEC) {
        return NextResponse.json({
          error: `Зачекайте ${RATE_LIMIT_SEC - (nowSec - last)} с перед наступним запитом (обмеження monobank)`,
        }, { status: 429 });
      }
    }

    const fromUnix = Math.floor(fromDate.getTime() / 1000);
    let toUnix = Math.floor(toDate.getTime() / 1000);
    const token = account.connection.token;
    let totalSaved = 0;

    // Пагінація по 500 транзакцій
    for (;;) {
      const items = await fetchStatement(token, account.externalId, fromUnix, toUnix);
      for (const it of items) {
        const time = new Date((it.time || 0) * 1000);
        await prisma.bankStatementItem.upsert({
          where: {
            accountId_externalId: { accountId: account.id, externalId: String(it.id) },
          },
          create: {
            accountId: account.id,
            externalId: String(it.id),
            time,
            description: it.description ?? "",
            amount: BigInt(it.amount ?? 0),
            balance: it.balance != null ? BigInt(it.balance) : null,
            hold: it.hold ?? false,
            mcc: it.mcc ?? null,
            operationAmount: it.operationAmount ? (it.operationAmount as object) : null,
          },
          update: {
            time,
            description: it.description ?? "",
            amount: BigInt(it.amount ?? 0),
            balance: it.balance != null ? BigInt(it.balance) : null,
            hold: it.hold ?? false,
            mcc: it.mcc ?? null,
            operationAmount: it.operationAmount ? (it.operationAmount as object) : null,
          },
        });
        totalSaved++;
      }
      if (items.length < 500) break;
      toUnix = items[items.length - 1].time - 1;
    }

    await kvWrite.setRaw(rateLimitKey, String(nowSec));

    // Повертаємо збережені транзакції з БД, щоб клієнт одразу їх відобразив без окремого GET
    const items = await prisma.bankStatementItem.findMany({
      where: {
        accountId,
        time: { gte: fromDate, lte: toDate },
      },
      orderBy: { time: "desc" },
      take: 2000,
    });

    return NextResponse.json({
      ok: true,
      accountId,
      saved: totalSaved,
      items: items.map((i) => ({
        id: i.id,
        externalId: i.externalId,
        time: i.time.toISOString(),
        description: i.description,
        amount: i.amount.toString(),
        balance: i.balance != null ? i.balance.toString() : null,
        hold: i.hold,
        mcc: i.mcc,
      })),
    });
  } catch (err) {
    console.error("[bank/statement/sync] error:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Помилка синхронізації виписки",
    }, { status: 500 });
  }
}
