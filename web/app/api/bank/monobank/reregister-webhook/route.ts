// web/app/api/bank/monobank/reregister-webhook/route.ts
// POST: повторно зареєструвати URL вебхука в Monobank (якщо вимкнувся після 3 невдалих спроб)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { setWebhook, getWebhook } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Вебхук завжди на production — preview може бути холодним, NEXT_PUBLIC_BASE_URL на preview вказує на preview
const WEBHOOK_PRODUCTION_URL = "https://p-3-0.vercel.app";

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

    const webhookUrl = `${WEBHOOK_PRODUCTION_URL}/api/bank/monobank/webhook`;
    // Розігріваємо endpoint — Monobank надсилає GET для валідації протягом 5 с, холодний Vercel може не встигнути
    try {
      await fetch(webhookUrl, { method: "GET" });
    } catch (_) {
      // Ігноруємо помилку розігріву
    }
    try {
      await setWebhook(connection.token, webhookUrl);
    } catch (setErr) {
      const msg = setErr instanceof Error ? setErr.message : String(setErr);
      if (msg.includes("429") || msg.includes("Too many requests")) {
        console.warn("[bank/monobank/reregister-webhook] 429 від Monobank:", msg);
        return NextResponse.json(
          { error: "Забагато запитів до API Monobank (ліміт). Зачекайте близько 1 хвилини та спробуйте знову." },
          { status: 429 }
        );
      }
      throw setErr;
    }

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { webhookUrl },
    });

    // Перевіряємо, що Monobank зберіг саме наш URL (GET /personal/webhook)
    let monobankStoredUrl: string | null = null;
    try {
      monobankStoredUrl = await getWebhook(connection.token) || null;
    } catch (e) {
      console.warn("[bank/monobank/reregister-webhook] getWebhook after setWebhook:", e);
    }

    console.log("[bank/monobank/reregister-webhook] OK, connectionId:", connectionId, "| monobankStored:", monobankStoredUrl);
    return NextResponse.json({
      ok: true,
      message: "Вебхук повторно зареєстровано",
      webhookUrl,
      monobankStoredUrl,
      match: monobankStoredUrl === webhookUrl,
    });
  } catch (err) {
    console.error("[bank/monobank/reregister-webhook] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка реєстрації вебхука" },
      { status: 500 }
    );
  }
}
