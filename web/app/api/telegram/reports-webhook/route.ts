import { NextRequest, NextResponse } from "next/server";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import { kvWrite } from "@/lib/kv";
import { handleEncashmentOwnerTelegramCallback } from "@/lib/finance/encashment-confirmation-telegram";
import { bindDailyReportTelegramChat } from "@/lib/reports/recipients";
import { deliverDailyReport } from "@/lib/reports/delivery";
import {
  consumePendingAccess,
  consumePendingAccessForUser,
  peekPendingAccessByToken,
} from "@/lib/access/pending-access";
import { normalizeTelegramUsername } from "@/lib/access/normalize-telegram-username";
import { prisma } from "@/lib/prisma";

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

function parseStartPayload(text: string | undefined): string | null {
  const m = String(text || "").trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  if (!m) return null;
  const payload = (m[1] || "").trim();
  return payload || null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function deliverPendingAccessCredentials(input: {
  chatId: number;
  botToken: string;
  pending: {
    login: string;
    password: string;
    crescoLoginUrl: string;
    telegramUsername: string;
    token: string;
  };
  fromUsername: string | null;
}): Promise<boolean> {
  const fromNorm = normalizeTelegramUsername(input.fromUsername);
  const expectNorm = normalizeTelegramUsername(input.pending.telegramUsername);
  if (!fromNorm || !expectNorm || fromNorm !== expectNorm) {
    await sendMessage(
      input.chatId,
      [
        "<b>Це посилання доступу призначене іншому Telegram-акаунту.</b>",
        "",
        expectNorm ? `Очікується @${escapeHtml(expectNorm)}.` : "Очікується інший username.",
        fromNorm ? `Зараз ви: @${escapeHtml(fromNorm)}.` : "У вашому профілі немає username.",
        "",
        "Відкрийте посилання з того акаунта, який вказаний у Доступах, або попросіть адміна надіслати доступ ще раз.",
      ].join("\n"),
      {},
      input.botToken,
    );
    return false;
  }

  const consumed = await consumePendingAccess(input.pending.token);
  if (!consumed) return false;

  const text =
    `<b>Доступ до Креско CRM</b>\n\n` +
    `Посилання: ${escapeHtml(consumed.crescoLoginUrl)}\n` +
    `Логін: <code>${escapeHtml(consumed.login)}</code>\n` +
    `Пароль: <code>${escapeHtml(consumed.password)}</code>`;

  await sendMessage(
    input.chatId,
    text,
    { parse_mode: "HTML", disable_web_page_preview: true },
    input.botToken,
  );
  console.log("[reports-webhook] Видано pending-доступ", {
    login: consumed.login,
    telegramUsername: consumed.telegramUsername,
    chatId: input.chatId,
  });
  return true;
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

    const incomingChat = update.message?.chat ?? update.callback_query?.message?.chat;
    if (incomingChat && (incomingChat.type === "group" || incomingChat.type === "supergroup")) {
      console.log("[reports-webhook] Група: команди повного звіту ігноруємо, chat id не привʼязуємо", {
        chatId: incomingChat.id,
        title: incomingChat.title || null,
        type: incomingChat.type,
      });
      await logReportsBotUpdate({
        event: "group_ignored",
        chatId: incomingChat.id,
        title: incomingChat.title ?? null,
        type: incomingChat.type,
        messageText: update.message?.text ?? null,
      });
      return NextResponse.json({
        ok: true,
        handled: "group_ignored",
        chatId: incomingChat.id,
      });
    }

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
      const fromUsername = update.message?.from?.username ?? null;
      const startPayload = parseStartPayload(messageText);

      // Deep-link «Надіслати доступ»: /start access_<token>
      let deliveredPending = false;
      if (startPayload?.startsWith("access_")) {
        const token = startPayload.slice("access_".length).trim();
        const pending = token ? await peekPendingAccessByToken(token) : null;
        if (pending) {
          deliveredPending = await deliverPendingAccessCredentials({
            chatId,
            botToken,
            pending,
            fromUsername,
          });
        } else {
          await sendMessage(
            chatId,
            "Посилання доступу вже використане або протерміноване. Попросіть адміна натиснути «Надіслати доступ» ще раз.",
            {},
            botToken,
          );
        }
      }

      const bind = await bindDailyReportTelegramChat({
        chatId,
        telegramUserId: update.message?.from?.id ?? null,
        telegramUsername: fromUsername,
      });

      // Звичайний /start після «Надіслати доступ» без deep-link — теж видаємо pending за userId
      const fromNorm = normalizeTelegramUsername(fromUsername);
      if (bind.ok && !deliveredPending && fromNorm) {
        const matchedUser = await prisma.appUser.findFirst({
          where: {
            isActive: true,
            telegramUsername: { equals: fromNorm, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (matchedUser) {
          const pendingByUser = await consumePendingAccessForUser(matchedUser.id);
          if (pendingByUser) {
            const text =
              `<b>Доступ до Креско CRM</b>\n\n` +
              `Посилання: ${escapeHtml(pendingByUser.crescoLoginUrl)}\n` +
              `Логін: <code>${escapeHtml(pendingByUser.login)}</code>\n` +
              `Пароль: <code>${escapeHtml(pendingByUser.password)}</code>`;
            await sendMessage(
              chatId,
              text,
              { parse_mode: "HTML", disable_web_page_preview: true },
              botToken,
            );
            deliveredPending = true;
            console.log("[reports-webhook] Видано pending-доступ після звичайного /start", {
              login: pendingByUser.login,
              chatId,
            });
          }
        }
      }

      if (bind.ok) {
        const lines = [
          "<b>Бот звітів підключено.</b>",
          "",
          `Вітаємо, ${bind.userName || "колего"}!`,
        ];
        if (deliveredPending) {
          lines.push("", "Логін і пароль до Креско надіслано повідомленням вище.");
        }
        if (bind.canReceiveReport) {
          lines.push(
            "Ви підписані на <b>щоденний операційний звіт</b> (наступного ранку, ~9:00 Kyiv, за вчора).",
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
            fromUsername ? `Username: @${fromUsername}` : null,
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
        username: fromUsername,
        bindOk: bind.ok,
        canReceiveReport: bind.canReceiveReport,
        deliveredPending,
        startPayload,
      });
      return NextResponse.json({ ok: true, handled: "start", deliveredPending });
    }

    return NextResponse.json({ ok: true, handled: false });
  } catch (error) {
    console.error("[reports-webhook] POST error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
