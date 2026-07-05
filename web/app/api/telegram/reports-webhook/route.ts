import { NextRequest, NextResponse } from "next/server";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { kvWrite } from "@/lib/kv";
import { bindSalonOwnerTelegramChat } from "@/lib/finance/encashment-owner-chats";
import { handleEncashmentOwnerTelegramCallback } from "@/lib/finance/encashment-confirmation-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getReportsBotToken(): string {
  const token = TELEGRAM_ENV.REPORTS_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing TELEGRAM_REPORTS_BOT_TOKEN env variable");
  }
  return token;
}

async function logReportsBotUpdate(payload: object) {
  try {
    await kvWrite.lpush("reports:telegram:webhook", JSON.stringify({
      at: new Date().toISOString(),
      ...payload,
    }));
    await kvWrite.ltrim("reports:telegram:webhook", 0, 199);
  } catch (error) {
    console.warn("[reports-webhook] Не вдалося записати KV лог:", error);
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, bot: "reports" });
}

export async function POST(req: NextRequest) {
  try {
    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    await logReportsBotUpdate({
      updateId: update.update_id,
      hasMessage: Boolean(update.message),
      hasCallbackQuery: Boolean(update.callback_query),
      chatId: update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? null,
      fromUsername: update.message?.from?.username ?? update.callback_query?.from?.username ?? null,
      callbackData: update.callback_query?.data ?? null,
      messageText: update.message?.text ?? null,
    });

    if (update.callback_query) {
      const handled = await handleEncashmentOwnerTelegramCallback(update.callback_query);
      return NextResponse.json({ ok: true, handled: handled ? "encashment_confirm" : false });
    }

    if (update.message?.text?.startsWith("/start")) {
      const chatId = update.message.chat.id;
      const botToken = getReportsBotToken();
      const bind = await bindSalonOwnerTelegramChat({
        chatId,
        telegramUserId: update.message.from?.id ?? null,
        telegramUsername: update.message.from?.username ?? null,
      });

      if (bind.ok) {
        await sendMessage(
          chatId,
          [
            "<b>Бот звітів підключено.</b>",
            "",
            `Вітаємо, ${bind.ownerName || "власнице"}!`,
            "Тут ви отримуватимете запити на підтвердження інкасації з фінансового звіту.",
            "",
            `Ваш chat_id: <code>${chatId}</code>`,
          ].join("\n"),
          {},
          botToken,
        );
      } else {
        await sendMessage(
          chatId,
          [
            "<b>Бот звітів</b>",
            "",
            bind.error || "Не вдалося прив'язати акаунт",
            "",
            "Переконайтесь, що у розділі Доступи для вас вказано Telegram username і посаду «Власник».",
            "",
            `Ваш chat_id: <code>${chatId}</code>`,
            update.message.from?.username
              ? `Username: @${update.message.from.username}`
              : null,
          ].filter(Boolean).join("\n"),
          {},
          botToken,
        );
      }

      await logReportsBotUpdate({
        event: "start_ack_sent",
        chatId,
        username: update.message.from?.username ?? null,
        bindOk: bind.ok,
      });
      return NextResponse.json({ ok: true, handled: "start" });
    }

    return NextResponse.json({ ok: true, handled: false });
  } catch (error) {
    console.error("[reports-webhook] POST error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
