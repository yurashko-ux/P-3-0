import { NextRequest, NextResponse } from "next/server";
import { requireFinanceReportAccess } from "@/lib/finance/require-finance-report-access";
import { TELEGRAM_ENV, telegramApiUrl } from "@/lib/telegram/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_WEBHOOK_URL = "https://p-3-0.vercel.app/api/telegram/reports-webhook";

async function telegramGetWebhookInfo(botToken: string) {
  const response = await fetch(telegramApiUrl("getWebhookInfo", botToken));
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.description || `Telegram getWebhookInfo HTTP ${response.status}`);
  }
  return data.result as { url?: string; pending_update_count?: number };
}

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

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    if (!TELEGRAM_ENV.REPORTS_BOT_TOKEN) {
      return NextResponse.json({
        ok: false,
        tokenConfigured: false,
        error: "TELEGRAM_REPORTS_BOT_TOKEN не задано у Vercel env",
      });
    }

    const webhookInfo = await telegramGetWebhookInfo(TELEGRAM_ENV.REPORTS_BOT_TOKEN);
    const registered = webhookInfo.url === DEFAULT_WEBHOOK_URL;

    return NextResponse.json({
      ok: true,
      tokenConfigured: true,
      expectedWebhookUrl: DEFAULT_WEBHOOK_URL,
      webhookUrl: webhookInfo.url || null,
      registered,
      pendingUpdateCount: webhookInfo.pending_update_count ?? 0,
    });
  } catch (error) {
    console.error("[finance-report/register-reports-telegram-webhook] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка перевірки webhook" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceReportAccess(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    if (!TELEGRAM_ENV.REPORTS_BOT_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "TELEGRAM_REPORTS_BOT_TOKEN не задано у Vercel env" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const webhookUrl = typeof body.webhookUrl === "string" && body.webhookUrl.trim()
      ? body.webhookUrl.trim()
      : DEFAULT_WEBHOOK_URL;

    const result = await telegramSetWebhook(TELEGRAM_ENV.REPORTS_BOT_TOKEN, webhookUrl);
    const webhookInfo = await telegramGetWebhookInfo(TELEGRAM_ENV.REPORTS_BOT_TOKEN);
    return NextResponse.json({
      ok: true,
      webhookUrl,
      registered: webhookInfo.url === webhookUrl,
      pendingUpdateCount: webhookInfo.pending_update_count ?? 0,
      result,
    });
  } catch (error) {
    console.error("[finance-report/register-reports-telegram-webhook] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка реєстрації reports webhook" },
      { status: 500 },
    );
  }
}
