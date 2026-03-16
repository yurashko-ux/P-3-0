// web/app/api/bank/monobank/reregister-webhook/route.ts
// POST: повторно зареєструвати URL вебхука в Monobank (якщо вимкнувся після 3 невдалих спроб)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { setWebhook } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBaseUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://p-3-0.vercel.app";
}

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

    const webhookUrl = `${getBaseUrl()}/api/bank/monobank/webhook`;
    await setWebhook(connection.token, webhookUrl);

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { webhookUrl },
    });

    console.log("[bank/monobank/reregister-webhook] OK, connectionId:", connectionId);
    return NextResponse.json({
      ok: true,
      message: "Вебхук повторно зареєстровано",
      webhookUrl,
    });
  } catch (err) {
    console.error("[bank/monobank/reregister-webhook] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка реєстрації вебхука" },
      { status: 500 }
    );
  }
}
