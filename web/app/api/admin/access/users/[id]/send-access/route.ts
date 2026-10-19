// POST /api/admin/access/users/[id]/send-access
// Зберігає (за потреби) пароль/Telegram і надсилає доступ у Telegram (посилання Креско + логін + пароль).
// Якщо telegramChatId ще немає — створює deep-link: користувач тисне /start і бот сам видає доступ.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth-rbac";
import { normalizeTelegramUsername } from "@/lib/access/normalize-telegram-username";
import { CRESCO_LOGIN_URL } from "@/lib/access/cresco-login-url";
import {
  createPendingAccess,
  REPORTS_BOT_USERNAME,
} from "@/lib/access/pending-access";
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

function buildAccessMessage(login: string, password: string, crescoLoginUrl: string): string {
  return (
    `<b>Доступ до Креско CRM</b>\n\n` +
    `Посилання: ${escapeHtml(crescoLoginUrl)}\n` +
    `Логін: <code>${escapeHtml(login)}</code>\n` +
    `Пароль: <code>${escapeHtml(password)}</code>`
  );
}

async function logOutgoing(payload: object) {
  try {
    await kvWrite.lpush(
      "access:telegram:outgoing",
      JSON.stringify({
        at: new Date().toISOString(),
        event: "send_access",
        ...payload,
      }),
    );
    await kvWrite.ltrim("access:telegram:outgoing", 0, 99);
  } catch (kvErr) {
    console.warn("[access/send-access] KV log failed:", kvErr);
  }
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

  const text = buildAccessMessage(user.login, password, crescoLoginUrl);
  let chatId = toChatId(user.telegramChatId);

  // 1) Якщо є chatId — шлемо напряму
  if (chatId) {
    try {
      await sendMessage(
        chatId,
        text,
        { parse_mode: "HTML", disable_web_page_preview: true },
        TELEGRAM_ENV.REPORTS_BOT_TOKEN,
      );
      await logOutgoing({
        userId: user.id,
        chatId,
        telegramUsername,
        login: user.login,
        crescoLoginUrl,
        ok: true,
        via: "chatId",
      });
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
      console.error("[access/send-access] Telegram error (chatId):", msg);
      // якщо chatId «протух» — пробуємо далі через @username / deep-link
      chatId = null;
    }
  }

  // 2) Спроба через @username (працює лише якщо людина вже колись писала боту)
  try {
    await sendMessage(
      `@${telegramUsername}`,
      text,
      { parse_mode: "HTML", disable_web_page_preview: true },
      TELEGRAM_ENV.REPORTS_BOT_TOKEN,
    );
    await logOutgoing({
      userId: user.id,
      telegramUsername,
      login: user.login,
      crescoLoginUrl,
      ok: true,
      via: "username",
    });
    console.log("[access/send-access] Надіслано доступ через @username:", {
      userId: user.id,
      login: user.login,
      telegramUsername,
    });
    return NextResponse.json({
      ok: true,
      sent: true,
      passwordSaved: true,
      login: user.login,
      telegramUsername,
      crescoLoginUrl,
      via: "username",
    });
  } catch (err) {
    console.warn("[access/send-access] @username не спрацював (очікувано без /start):", {
      telegramUsername,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3) Немає привʼязки — створюємо deep-link: після /start бот сам видасть доступ
  const pending = await createPendingAccess({
    userId: user.id,
    login: user.login,
    password,
    crescoLoginUrl,
    telegramUsername,
  });

  await logOutgoing({
    userId: user.id,
    telegramUsername,
    login: user.login,
    crescoLoginUrl,
    ok: true,
    via: "pending_deeplink",
    deepLink: pending.deepLink,
    expiresAt: pending.expiresAt,
  });

  console.log("[access/send-access] Немає chatId — створено deep-link", {
    userId: user.id,
    login: user.login,
    telegramUsername,
    deepLink: pending.deepLink,
  });

  return NextResponse.json({
    ok: true,
    sent: false,
    pending: true,
    passwordSaved: true,
    login: user.login,
    telegramUsername,
    crescoLoginUrl,
    deepLink: pending.deepLink,
    expiresAt: pending.expiresAt,
    botUsername: REPORTS_BOT_USERNAME,
    message:
      `Пароль збережено. У @${telegramUsername} ще немає привʼязки Telegram. ` +
      `Надішліть їй це посилання — після відкриття бот сам видасть логін і пароль: ${pending.deepLink}`,
  });
}
