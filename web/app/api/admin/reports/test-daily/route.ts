// Тестова відправка щоденного звіту (AdminToolsModal).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { prisma } from "@/lib/prisma";
import { deliverDailyReport, previewDailyReportText } from "@/lib/reports/delivery";
import { getDailyReportRecipients } from "@/lib/reports/recipients";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import type { AuthContext } from "@/lib/auth-rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(
  req: NextRequest,
  auth: Awaited<ReturnType<typeof getAuthContext>>,
): boolean {
  const host = req.headers.get("host") || "";
  if (isPreviewDeploymentHost(host)) return true;
  if (!auth) return false;
  if (auth.type === "superadmin") return true;
  return auth.permissions.debugSection === "edit" || auth.permissions.debugSection === "view";
}

function toChatId(value: bigint | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseChatIdInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  return null;
}

async function resolveMeTestChatId(
  auth: AuthContext | null,
  body: Record<string, unknown>,
): Promise<number | null> {
  const fromBody = parseChatIdInput(body.chatId);
  if (fromBody) return fromBody;

  if (auth?.type === "user" && auth.userId) {
    const user = await prisma.appUser.findUnique({
      where: { id: auth.userId },
      select: { telegramChatId: true },
    });
    const chatId = toChatId(user?.telegramChatId ?? null);
    if (chatId) return chatId;
  }

  const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
  if (login) {
    const user = await prisma.appUser.findFirst({
      where: { isActive: true, login },
      select: { telegramChatId: true },
    });
    const chatId = toChatId(user?.telegramChatId ?? null);
    if (chatId) return chatId;
  }

  const recipients = await getDailyReportRecipients();
  if (recipients.length === 1) return recipients[0].chatId;

  const mykolay = recipients.find((recipient) => {
    const name = recipient.name.trim().toLowerCase();
    const username = String(recipient.telegramUsername || "").trim().toLowerCase();
    return (
      name.includes("mykolay") ||
      name.includes("миколай") ||
      username === "mykolay" ||
      username === "mykolay007"
    );
  });
  if (mykolay) return mykolay.chatId;

  return null;
}

async function resolveUserTestChatId(loginRaw: string): Promise<{
  chatId: number;
  name: string;
} | null> {
  const login = loginRaw.trim().toLowerCase();
  if (!login) return null;

  const user = await prisma.appUser.findFirst({
    where: { isActive: true, login },
    select: {
      name: true,
      telegramChatId: true,
      function: { select: { permissions: true } },
    },
  });
  if (!user) return null;

  const chatId = toChatId(user.telegramChatId ?? null);
  if (!chatId) return null;

  return { chatId, name: user.name };
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dayRaw = typeof body?.day === "string" ? body.day.trim().replace(/\//g, "-") : "";
    if (dayRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) {
      return NextResponse.json(
        { ok: false, error: "Невірний формат дати. Очікується YYYY-MM-DD" },
        { status: 400 },
      );
    }
    const kyivDay = getTodayKyiv(dayRaw || null);
    const mode = String(body?.mode || "me");
    const previewOnly = body?.previewOnly === true;

    if (previewOnly) {
      const preview = await previewDailyReportText({ kyivDay });
      return NextResponse.json({ ok: true, previewOnly: true, ...preview });
    }

    let chatIds: number[] | undefined;
    let targetLabel: string | undefined;
    if (mode === "all") {
      chatIds = undefined;
    } else if (mode === "user") {
      const login = typeof body?.login === "string" ? body.login.trim().toLowerCase() : "";
      if (!login) {
        return NextResponse.json(
          { ok: false, error: "Для mode=user потрібен login (наприклад vika)" },
          { status: 400 },
        );
      }
      const userTarget = await resolveUserTestChatId(login);
      if (!userTarget) {
        return NextResponse.json(
          {
            ok: false,
            error: `Користувача ${login} не знайдено або немає telegramChatId (/start у боті).`,
          },
          { status: 400 },
        );
      }
      chatIds = [userTarget.chatId];
      targetLabel = `${userTarget.name} (${userTarget.chatId})`;
    } else {
      const chatId = await resolveMeTestChatId(auth, body as Record<string, unknown>);
      if (!chatId) {
        const recipients = await getDailyReportRecipients();
        const hint =
          recipients.length > 0
            ? ` Доступні підписники: ${recipients
                .map((recipient) => `${recipient.name} (${recipient.chatId})`)
                .join(", ")}.`
            : "";
        return NextResponse.json(
          {
            ok: false,
            error:
              "Немає прив'язаного telegramChatId. Надішліть /start боту @ZVITY_HoB_bot або вкажіть chatId у тесті." +
              hint,
          },
          { status: 400 },
        );
      }
      chatIds = [chatId];
    }

    const result = await deliverDailyReport({ kyivDay, chatIds });
    return NextResponse.json({
      ok: result.ok,
      mode,
      targetLabel,
      kyivDay: result.kyivDay,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
      deliveries: result.deliveries,
      text: result.text,
      errors: result.errors,
    });
  } catch (error) {
    console.error("[admin/reports/test-daily] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
