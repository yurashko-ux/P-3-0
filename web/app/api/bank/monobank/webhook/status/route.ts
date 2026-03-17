// web/app/api/bank/monobank/webhook/status/route.ts
// GET: що збережено в Monobank як webHookUrl (з client-info) — діагностика

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { getWebhook } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Має збігатися з URL при реєстрації вебхука — завжди production
const WEBHOOK_PRODUCTION_URL = "https://p-3-0.vercel.app";

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const connectionId = req.nextUrl.searchParams.get("connectionId")?.trim();
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId обов'язковий" }, { status: 400 });
  }

  try {
    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, token: true, name: true, webhookUrl: true },
    });
    if (!connection || !connection.token) {
      return NextResponse.json({ error: "Підключення не знайдено" }, { status: 404 });
    }

    const monobankStoredUrl = await getWebhook(connection.token);
    const ourUrl = `${WEBHOOK_PRODUCTION_URL}/api/bank/monobank/webhook`;

    return NextResponse.json({
      ok: true,
      connectionId,
      ourUrl,
      monobankStoredUrl,
      match: monobankStoredUrl === ourUrl,
      savedInDb: connection.webhookUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.includes("Too many requests")) {
      return NextResponse.json(
        { error: "Забагато запитів до Monobank. Зачекайте близько 1 хвилини." },
        { status: 429 }
      );
    }
    console.error("[bank/monobank/webhook/status] error:", err);
    return NextResponse.json(
      { error: msg || "Помилка перевірки статусу" },
      { status: 500 }
    );
  }
}
