// web/app/api/admin/direct/clients/[id]/send-phone-to-telegram/route.ts
// Порядок: телефон (tel:) → майстри як у колонці «Майстер» → посилання на сторінку Instagram (якщо є нік).

import { NextRequest, NextResponse } from "next/server";
import { getDirectClient } from "@/lib/direct-store";
import { getAllDirectMasters } from "@/lib/direct-masters/store";
import { sendMessage } from "@/lib/telegram/api";
import { getDirectRemindersBotToken } from "@/lib/direct-reminders/telegram";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { verifyUserToken } from "@/lib/auth-rbac";
import { getMasterColumnNamesLikeTable } from "@/lib/direct-master-column-names";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get("host") || "")) return true;
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

async function resolveParams(params: { id: string } | Promise<{ id: string }>): Promise<{ id: string }> {
  return typeof (params as { then?: unknown })?.then === "function"
    ? await (params as Promise<{ id: string }>)
    : (params as { id: string });
}

function normalizePhone(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Як у колонці «Телефон»: нормалізований +380… для tel: і відображення */
function phoneDisplayAndTelHref(phone: string): { display: string; href: string } | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits.length) return null;
  let tel: string | null = null;
  if (digits.startsWith("380") && digits.length >= 12) {
    tel = `+${digits.slice(0, 12)}`;
  } else if (digits.startsWith("0") && digits.length >= 9) {
    tel = `+38${digits}`;
  } else if (digits.length >= 10) {
    tel = `+${digits}`;
  }
  if (!tel) return null;
  return { display: tel, href: `tel:${tel.replace(/\s/g, "")}` };
}

/**
 * Посилання на профіль Instagram (один тап у Telegram).
 * Для missing_instagram_<id> — лише текст @missing_instagram без посилання.
 */
function instagramHtmlLine(username: string | undefined | null): string | null {
  const raw = (username || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith("missing_instagram_")) {
    return escapeHtml("@missing_instagram");
  }
  if (
    lower === "no instagram" ||
    lower.startsWith("no_instagram_") ||
    lower.startsWith("binotel_")
  ) {
    return null;
  }
  const clean = raw.replace(/^@/, "").replace(/\s/g, "");
  if (!clean) return null;
  const url = `https://instagram.com/${encodeURIComponent(clean)}`;
  const label = `@${clean}`;
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function normalizeChatId(raw: unknown): number | null {
  if (typeof raw === "bigint") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function buildTelegramMessageHtml(phone: string, instagramUsername: string | undefined, masterNames: string[]): string {
  const parts: string[] = [];

  const tel = phoneDisplayAndTelHref(phone);
  if (tel) {
    parts.push(`<a href="${escapeHtml(tel.href)}">${escapeHtml(tel.display)}</a>`);
  } else {
    parts.push(escapeHtml(phone));
  }

  if (masterNames.length > 0) {
    const lines = masterNames.map((n, i) =>
      i === 0 ? `Майстер: ${escapeHtml(n)}` : escapeHtml(n)
    );
    parts.push(lines.join("\n"));
  }

  const ig = instagramHtmlLine(instagramUsername);
  if (ig) {
    parts.push(ig);
  }

  return parts.join("\n");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await resolveParams(params);
    if (!id || typeof id !== "string" || !id.trim()) {
      return NextResponse.json({ ok: false, error: "Client ID is required" }, { status: 400 });
    }

    const client = await getDirectClient(id);
    if (!client) {
      return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
    }

    const phone = normalizePhone(client.phone);
    if (!phone) {
      return NextResponse.json({ ok: false, error: "У клієнта відсутній номер телефону" }, { status: 400 });
    }

    const masters = await getAllDirectMasters();
    const adminChatIds = masters
      .filter((m) => m.role === "admin")
      .map((m) => normalizeChatId(m.telegramChatId))
      .filter((x): x is number => x != null);
    const uniqueAdminChatIds = Array.from(new Set(adminChatIds));

    if (uniqueAdminChatIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Не знайдено Telegram Chat ID у відповідальних з роллю Адміністратор" },
        { status: 409 }
      );
    }

    const botToken = getDirectRemindersBotToken();
    const masterNames = getMasterColumnNamesLikeTable(client, masters);

    const message = buildTelegramMessageHtml(phone, client.instagramUsername, masterNames);

    console.log(
      `[send-phone-to-telegram] clientId=${client.id} довжина повідомлення=${message.length} майстрів=${masterNames.length}`
    );

    let sentCount = 0;
    const errors: string[] = [];

    for (const chatId of uniqueAdminChatIds) {
      try {
        await sendMessage(chatId, message, {}, botToken);
        sentCount += 1;
      } catch (err) {
        errors.push(`chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (sentCount === 0) {
      return NextResponse.json(
        { ok: false, error: "Не вдалося відправити повідомлення в Telegram", details: errors },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: sentCount,
      total: uniqueAdminChatIds.length,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
