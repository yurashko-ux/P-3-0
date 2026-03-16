// web/app/api/bank/monobank/delete-webhook/route.ts
// POST: вимкнути вебхук в Monobank (DELETE /personal/webhook)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { deleteWebhook } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId обов'язковий" }, { status: 400 });
  }

  try {
    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, token: true, name: true },
    });
    if (!connection || !connection.token) {
      return NextResponse.json({ error: "Підключення не знайдено або немає токена" }, { status: 404 });
    }

    await deleteWebhook(connection.token);
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { webhookUrl: null },
    });

    console.log("[bank/monobank/delete-webhook] OK, connectionId:", connectionId);
    return NextResponse.json({ ok: true, message: "Вебхук вимкнено в Monobank" });
  } catch (err) {
    console.error("[bank/monobank/delete-webhook] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка вимкнення вебхука" },
      { status: 500 }
    );
  }
}
