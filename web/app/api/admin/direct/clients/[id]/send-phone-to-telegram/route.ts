// web/app/api/admin/direct/clients/[id]/send-phone-to-telegram/route.ts
// Надсилає телефон клієнта в Telegram чат(и) адміністраторів.

import { NextRequest, NextResponse } from "next/server";
import { getDirectClient } from "@/lib/direct-store";
import { getAllDirectMasters } from "@/lib/direct-masters/store";
import { sendMessage } from "@/lib/telegram/api";
import { getDirectRemindersBotToken } from "@/lib/direct-reminders/telegram";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { verifyUserToken } from "@/lib/auth-rbac";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const DIRECT_PAGE_URL = "https://p-3-0.vercel.app/admin/direct";

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
    const fullName = [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || "Без імені";
    const responsibleMaster = client.masterId ? masters.find((m) => m.id === client.masterId) : null;
    const responsibleName = responsibleMaster?.name || "Не призначено";

    const message = [
      "<b>Клієнт передзвонити</b>",
      `Ім'я: ${escapeHtml(fullName)}`,
      `Телефон: <code>${escapeHtml(phone)}</code>`,
      `Instagram: @${escapeHtml(client.instagramUsername || "-")}`,
      `Відповідальний: ${escapeHtml(responsibleName)}`,
      `Посилання: ${escapeHtml(DIRECT_PAGE_URL)}`,
    ].join("\n");

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
