import { NextRequest, NextResponse } from "next/server";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { kvWrite } from "@/lib/kv";
import { handleBankPaymentTelegramCallback } from "@/lib/bank/payment-reconciliation-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getPaymentsBotToken(): string {
  const token = TELEGRAM_ENV.PAYMENTS_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing TELEGRAM_PAYMENTS_BOT_TOKEN env variable");
  }
  return token;
}

async function logPaymentBotUpdate(payload: object) {
  try {
    await kvWrite.lpush("bank:payment-reconcile:telegram:webhook", JSON.stringify({
      at: new Date().toISOString(),
      ...payload,
    }));
    await kvWrite.ltrim("bank:payment-reconcile:telegram:webhook", 0, 199);
  } catch (error) {
    console.warn("[payment-reconciliation-webhook] Не вдалося записати KV лог:", error);
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, bot: "payment-reconciliation" });
}

export async function POST(req: NextRequest) {
  try {
    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    await logPaymentBotUpdate({
      updateId: update.update_id,
      hasMessage: Boolean(update.message),
      hasCallbackQuery: Boolean(update.callback_query),
      chatId: update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? null,
      fromUsername: update.message?.from?.username ?? update.callback_query?.from?.username ?? null,
      callbackData: update.callback_query?.data ?? null,
      messageText: update.message?.text ?? null,
    });

    if (update.callback_query) {
      const handled = await handleBankPaymentTelegramCallback(update.callback_query);
      return NextResponse.json({ ok: true, handled });
    }

    if (update.message?.text?.startsWith("/start")) {
      const chatId = update.message.chat.id;
      const botToken = getPaymentsBotToken();
      await sendMessage(
        chatId,
        [
          "<b>Бот зведення ФОП-платежів підключено.</b>",
          "",
          `Ваш chat_id: <code>${chatId}</code>`,
          "",
          "Додайте цей chat_id у TELEGRAM_PAYMENTS_ADMIN_CHAT_IDS, щоб отримувати повідомлення про платежі.",
        ].join("\n"),
        {},
        botToken,
      );

      await logPaymentBotUpdate({
        event: "start_ack_sent",
        chatId,
        username: update.message.from?.username ?? null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[payment-reconciliation-webhook] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка payment Telegram webhook" },
      { status: 500 },
    );
  }
}
