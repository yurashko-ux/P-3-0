// Бот «Журнал майстра»: /start прив'язує Telegram-акаунт до TeamMember
// (за збігом username) і надсилає кнопку відкриття Mini App /master.

import { NextRequest, NextResponse } from "next/server";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { deleteMessage, sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV, assertMasterBotToken } from "@/lib/telegram/env";
import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://p-3-0.vercel.app").replace(/\/$/, "");
}

async function logUpdate(payload: object) {
  try {
    await kvWrite.lpush(
      "master-journal:telegram:webhook",
      JSON.stringify({ at: new Date().toISOString(), ...payload }),
    );
    await kvWrite.ltrim("master-journal:telegram:webhook", 0, 199);
  } catch (error) {
    console.warn("[master-bot-webhook] Не вдалося записати KV лог:", error);
  }
}

/** Шукає TeamMember за Telegram username (без урахування регістру і «@»). */
async function findTeamMemberByUsername(username: string | null | undefined) {
  const normalized = (username || "").trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;
  const candidates = await prisma.teamMember.findMany({
    where: { isActive: true, telegramUsername: { not: null } },
    select: {
      id: true,
      name: true,
      telegramUsername: true,
      altegioStaffId: true,
      journalVisibilityAsViewer: { select: { target: { select: { altegioStaffId: true } } } },
    },
  });
  return (
    candidates.find((m) => (m.telegramUsername || "").trim().replace(/^@/, "").toLowerCase() === normalized) || null
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, bot: "master-journal" });
}

export async function POST(req: NextRequest) {
  try {
    assertMasterBotToken();
    const botToken = TELEGRAM_ENV.MASTER_BOT_TOKEN;
    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    await logUpdate({
      updateId: update.update_id,
      hasMessage: Boolean(update.message),
      fromUsername: update.message?.from?.username ?? null,
      fromId: update.message?.from?.id ?? null,
      messageText: update.message?.text ?? null,
    });

    const message = update.message;
    if (!message?.text?.startsWith("/start")) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const fromId = message.from?.id ?? chatId;
    const username = message.from?.username ?? null;

    const member = await findTeamMemberByUsername(username);
    if (!member) {
      await sendMessage(
        chatId,
        [
          "Акаунт не прив'язано.",
          "",
          "Зверніться до адміністратора, щоб у вашій картці в розділі «Команда» був вказаний цей Telegram username" +
            (username ? ` (<code>@${username}</code>)` : "") +
            ".",
        ].join("\n"),
        {},
        botToken,
      );
      await logUpdate({ event: "start_not_linked", chatId, username });
      return NextResponse.json({ ok: true, handled: "not_linked" });
    }

    // Доступ є, якщо є власний altegioStaffId АБО налаштована видимість чужого журналу
    // (колонка «Журнал» у «Команді») — незалежно від ролі.
    const hasOwnStaffId = Boolean(member.altegioStaffId);
    const hasVisibilityTargets = member.journalVisibilityAsViewer.some((v) => v.target.altegioStaffId != null);
    if (!hasOwnStaffId && !hasVisibilityTargets) {
      await sendMessage(
        chatId,
        "Ваш акаунт знайдено, але не налаштовано видимість журналу. Зверніться до адміністратора (розділ «Команда» → колонка «Журнал»).",
        {},
        botToken,
      );
      await logUpdate({ event: "start_no_staff_id", chatId, memberId: member.id });
      return NextResponse.json({ ok: true, handled: "no_staff_id" });
    }

    await prisma.teamMember.update({
      where: { id: member.id },
      data: { telegramChatId: BigInt(fromId) },
    });

    // Одноразове прибирання старої reply-клавіатури (її надсилав попередній код до фіксу
    // inline_keyboard) — щоб під полем вводу не лишався дублікат кнопки "Мій журнал".
    const keyboardClearedKey = `master-journal:keyboard-cleared:${chatId}`;
    const alreadyCleared = await kvRead.getRaw(keyboardClearedKey);
    if (!alreadyCleared) {
      try {
        const cleanup = await sendMessage(chatId, "🧹", { reply_markup: { remove_keyboard: true } }, botToken);
        const cleanupMessageId = (cleanup as { message_id?: number })?.message_id;
        if (cleanupMessageId) await deleteMessage(chatId, cleanupMessageId, botToken);
      } catch (cleanupErr) {
        console.warn("[master-bot-webhook] Не вдалося прибрати стару клавіатуру:", cleanupErr);
      }
      await kvWrite.setRaw(keyboardClearedKey, "1");
    }

    // ВАЖЛИВО: саме inline_keyboard (не keyboard) — лише такі web_app-кнопки отримують
    // повний initData з підписаними даними користувача. KeyboardButton.web_app дає
    // лише порожній initData (можна тільки sendData назад у бота, без ідентифікації).
    await sendMessage(
      chatId,
      `Вітаємо, ${member.name}! Натисніть кнопку нижче, щоб відкрити свій журнал записів.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "Мій журнал", web_app: { url: `${appBaseUrl()}/master` } }]],
        },
      },
      botToken,
    );

    await logUpdate({ event: "start_linked", chatId, memberId: member.id, name: member.name });
    return NextResponse.json({ ok: true, handled: "linked" });
  } catch (error) {
    console.error("[master-bot-webhook] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
