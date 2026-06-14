import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { TELEGRAM_ENV, telegramApiUrl } from "@/lib/telegram/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_WEBHOOK_URL = "https://p-3-0.vercel.app/api/telegram/payment-reconciliation-webhook";

async function telegramSetWebhook(botToken: string, webhookUrl: string) {
  const response = await fetch(telegramApiUrl("setWebhook", botToken), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.description || `Telegram setWebhook HTTP ${response.status}`);
  }
  return data;
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    if (!TELEGRAM_ENV.PAYMENTS_BOT_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "TELEGRAM_PAYMENTS_BOT_TOKEN не задано у Vercel env" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const webhookUrl = typeof body.webhookUrl === "string" && body.webhookUrl.trim()
      ? body.webhookUrl.trim()
      : DEFAULT_WEBHOOK_URL;

    const result = await telegramSetWebhook(TELEGRAM_ENV.PAYMENTS_BOT_TOKEN, webhookUrl);
    return NextResponse.json({ ok: true, webhookUrl, result });
  } catch (error) {
    console.error("[payment-reconciliation/register-telegram-webhook] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка реєстрації payment webhook" },
      { status: 500 },
    );
  }
}
