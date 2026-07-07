import { NextRequest, NextResponse } from "next/server";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { kvWrite } from "@/lib/kv";
import { handleEncashmentOwnerTelegramCallback } from "@/lib/finance/encashment-confirmation-telegram";
import { bindDailyReportTelegramChat } from "@/lib/reports/recipients";
import { deliverDailyReport } from "@/lib/reports/delivery";

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
    await kvWrite.lpush(
      "reports:telegram:webhook",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
    await kvWrite.ltrim("reports:telegram:webhook", 0, 199);
  } catch (error) {
    console.warn("[reports-webhook] Не вдалося записати KV лог:", error);
  }
}

function isReportCommand(text: string | undefined): boolean {
  const normalized = String(text || "").trim().toLowerCase();
  return normalized === "/звіт" || normalized === "/zvit" || normalized === "/report";
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

    const messageText = update.message?.text;
    const chatId = update.message?.chat?.id;

    if (chatId && isReportCommand(messageText)) {
      const botToken = getReportsBotToken();
      const delivery = await deliverDailyReport({ chatIds: [chatId] });
      await logReportsBotUpdate({
        event: "report_command",
        chatId,
        sent: delivery.sent,
        failed: delivery.failed,
        errors: delivery.errors,
        deliveries: delivery.deliveries,
      });
      if (delivery.sent > 0) {
        return NextResponse.json({ ok: true, handled: "report_command" });
      }
      await sendMessage(
        chatId,
        delivery.errors[0] ||
          "Не вдалося надіслати звіт. Перевірте доступ у посади та надішліть /start боту @ZVITY_HoB_bot.",
        {},
        botToken,
      );
      return NextResponse.json({ ok: true, handled: "report_command_failed" });
    }

    if (messageText?.startsWith("/start") && chatId) {
      const botToken = getReportsBotToken();
      const bind = await bindDailyReportTelegramChat({
        chatId,
        telegramUserId: update.message?.from?.id ?? null,
        telegramUsername: update.message?.from?.username ?? null,
      });

      if (bind.ok) {
        const lines = [
          "<b>Бот звітів підключено.</b>",
          "",
          `Вітаємо, ${bind.userName || "колего"}!`,
        ];
        if (bind.canReceiveReport) {
          lines.push(
            "Ви підписані на <b>щоденний операційний звіт</b> (вечір, ~21:00 Kyiv).",
            "Команда <code>/звіт</code> — отримати звіт зараз.",
          );
        } else {
          lines.push(
            "Щоб отримувати <b>щоденний операційний звіт</b>, у вашої посади в розділі Доступи має бути увімкнено «Отримувати основний звіт в Telegram».",
            "Після збереження посади надішліть <code>/start</code> або <code>/звіт</code> ще раз.",
          );
        }
        if (bind.isEncashmentRole) {
          lines.push("", "Також тут ви отримуватимете запити на підтвердження інкасації.");
        }
        lines.push("", `Ваш chat_id: <code>${chatId}</code>`);
        await sendMessage(chatId, lines.join("\n"), {}, botToken);
      } else {
        await sendMessage(
          chatId,
          [
            "<b>Бот звітів</b>",
            "",
            bind.error || "Не вдалося прив'язати акаунт",
            "",
            "Переконайтесь, що у розділі Доступи для вас вказано Telegram username.",
            "",
            `Ваш chat_id: <code>${chatId}</code>`,
            update.message?.from?.username
              ? `Username: @${update.message.from.username}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
          {},
          botToken,
        );
      }

      await logReportsBotUpdate({
        event: "start_ack_sent",
        chatId,
        username: update.message?.from?.username ?? null,
        bindOk: bind.ok,
        canReceiveReport: bind.canReceiveReport,
      });
      return NextResponse.json({ ok: true, handled: "start" });
    }

    return NextResponse.json({ ok: true, handled: false });
  } catch (error) {
    console.error("[reports-webhook] POST error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
