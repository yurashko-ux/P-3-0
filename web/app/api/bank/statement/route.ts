// web/app/api/bank/statement/route.ts
// GET: виписка по рахунку за період (з БД)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const accountId = req.nextUrl.searchParams.get("accountId");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");

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
    return NextResponse.json({ error: "Невірні параметри from/to (очікується ISO дата)" }, { status: 400 });
  }

  try {
    const account = await prisma.bankAccount.findFirst({
      where: { id: accountId },
      select: { id: true, connectionId: true },
    });
    if (!account) {
      return NextResponse.json({ error: "Рахунок не знайдено" }, { status: 404 });
    }

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
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      items: items.map((i) => ({
        id: i.id,
        externalId: i.externalId,
        time: i.time.toISOString(),
        description: i.description,
        comment: i.comment ?? null,
        counterName: i.counterName ?? null,
        amount: i.amount.toString(),
        balance: i.balance != null ? i.balance.toString() : null,
        hold: i.hold,
        mcc: i.mcc,
      })),
    });
  } catch (err) {
    console.error("[bank/statement] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження виписки" },
      { status: 500 }
    );
  }
}
