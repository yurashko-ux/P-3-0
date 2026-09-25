// POST /api/admin/access/users/[id]/send-access
// Зберігає (за потреби) пароль/Telegram і надсилає доступ у Telegram (посилання Креско + логін + пароль).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth-rbac";
import { normalizeTelegramUsername } from "@/lib/access/normalize-telegram-username";
import { CRESCO_LOGIN_URL } from "@/lib/access/cresco-login-url";
import { sendMessage } from "@/lib/telegram/api";
import { TELEGRAM_ENV, assertReportsBotToken } from "@/lib/telegram/env";
import { kvWrite } from "@/lib/kv";
import { requireAccessSection } from "../../../require-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toChatId(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: Request, { params }: Params) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права редагувати користувачів" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID користувача обовʼязковий" }, { status: 400 });
  }

  let body: {
    password?: string;
    crescoLoginUrl?: string;
    telegramUsername?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Невалідний JSON" }, { status: 400 });
  }

  const password = String(body.password || "").trim();
  if (password.length < 4) {
    return NextResponse.json(
      {
        error:
          "Вкажіть пароль у полі «Новий пароль» (мін. 4 символи). Старий пароль з БД відновити неможливо.",
      },
      { status: 400 },
    );
  }

  const crescoLoginUrl = String(body.crescoLoginUrl || "").trim() || CRESCO_LOGIN_URL;
  if (!/^https?:\/\//i.test(crescoLoginUrl)) {
    return NextResponse.json(
      { error: "Посилання для входу в Креско має починатися з http:// або https://" },
      { status: 400 },
    );
  }

  const existing = await prisma.appUser.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  const telegramUsername =
    body.telegramUsername !== undefined
      ? normalizeTelegramUsername(body.telegramUsername)
      : existing.telegramUsername;

  if (!telegramUsername) {
    return NextResponse.json(
      { error: "Вкажіть Telegram username користувача" },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.appUser.update({
    where: { id },
    data: {
      passwordHash,
      telegramUsername,
    },
  });

  const chatId = toChatId(user.telegramChatId);
  if (!chatId) {
    console.warn("[access/send-access] Немає telegramChatId:", {
      userId: user.id,
      telegramUsername,
    });
    return NextResponse.json(
      {
        error:
          `У користувача @${telegramUsername} ще немає привʼязки Telegram chat. ` +
          `Попросіть надіслати /start боту @ZVITY_HoB_bot, після цього повторіть «Надіслати доступ». ` +
          `Пароль уже збережено.`,
        passwordSaved: true,
        login: user.login,
        telegramUsername,
      },
      { status: 409 },
    );
  }

  try {
    assertReportsBotToken();
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Немає TELEGRAM_REPORTS_BOT_TOKEN",
        passwordSaved: true,
      },
      { status: 500 },
    );
  }

  const text =
    `<b>Доступ до Креско CRM</b>\n\n` +
    `Посилання: ${escapeHtml(crescoLoginUrl)}\n` +
    `Логін: <code>${escapeHtml(user.login)}</code>\n` +
    `Пароль: <code>${escapeHtml(password)}</code>`;

  try {
    await sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true }, TELEGRAM_ENV.REPORTS_BOT_TOKEN);
    try {
      await kvWrite.lpush(
        "access:telegram:outgoing",
        JSON.stringify({
          at: new Date().toISOString(),
          event: "send_access",
          userId: user.id,
          chatId,
          telegramUsername,
          login: user.login,
          crescoLoginUrl,
          ok: true,
        }),
      );
      await kvWrite.ltrim("access:telegram:outgoing", 0, 99);
    } catch (kvErr) {
      console.warn("[access/send-access] KV log failed:", kvErr);
    }

    console.log("[access/send-access] Надіслано доступ:", {
      userId: user.id,
      login: user.login,
      chatId,
      telegramUsername,
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      passwordSaved: true,
      login: user.login,
      chatId,
      telegramUsername,
      crescoLoginUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[access/send-access] Telegram error:", msg);
    try {
      await kvWrite.lpush(
        "access:telegram:outgoing",
        JSON.stringify({
          at: new Date().toISOString(),
          event: "send_access",
          userId: user.id,
          chatId,
          telegramUsername,
          login: user.login,
          ok: false,
          error: msg,
        }),
      );
      await kvWrite.ltrim("access:telegram:outgoing", 0, 99);
    } catch {
      // ignore
    }
    return NextResponse.json(
      {
        error: `Не вдалося надіслати в Telegram: ${msg}. Пароль уже збережено.`,
        passwordSaved: true,
        login: user.login,
      },
      { status: 502 },
    );
  }
}
