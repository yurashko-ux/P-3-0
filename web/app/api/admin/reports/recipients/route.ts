// Діагностика отримувачів щоденного звіту (AdminToolsModal #99).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import {
  getDailyReportRecipientCandidates,
  getDailyReportRecipients,
} from "@/lib/reports/recipients";

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

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const candidates = await getDailyReportRecipientCandidates();
  const recipients = await getDailyReportRecipients();

  return NextResponse.json({
    ok: true,
    recipientCount: recipients.length,
    recipients: recipients.map((recipient) => ({
      name: recipient.name,
      chatId: recipient.chatId,
      telegramUsername: recipient.telegramUsername,
    })),
    candidates: candidates.map((candidate) => ({
      name: candidate.name,
      functionName: candidate.functionName,
      telegramUsername: candidate.telegramUsername,
      chatId: candidate.chatId,
      telegramDailyReport: candidate.telegramDailyReport,
      eligible: candidate.eligible,
      reason: candidate.reason,
    })),
  });
}
