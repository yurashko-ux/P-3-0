// Тестова відправка щоденного звіту (AdminToolsModal).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { prisma } from "@/lib/prisma";
import { deliverDailyReport, previewDailyReportText } from "@/lib/reports/delivery";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";

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
    if (mode === "all") {
      chatIds = undefined;
    } else {
      let chatId: number | null = null;
      if (auth?.type === "user" && auth.userId) {
        const user = await prisma.appUser.findUnique({
          where: { id: auth.userId },
          select: { telegramChatId: true },
        });
        chatId = toChatId(user?.telegramChatId ?? null);
      }
      if (!chatId && typeof body?.chatId === "number") {
        chatId = body.chatId;
      }
      if (!chatId) {
        return NextResponse.json({
          ok: false,
          error:
            "Немає прив'язаного telegramChatId. Надішліть /start боту @ZVITY_HoB_bot або вкажіть chatId у тілі запиту.",
        }, { status: 400 });
      }
      chatIds = [chatId];
    }

    const result = await deliverDailyReport({ kyivDay, chatIds });
    return NextResponse.json({
      ok: result.ok,
      mode,
      kyivDay: result.kyivDay,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
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
