// Відповідь клієнту в Instagram Direct з історії картки. Токен у відповідь не потрапляє.

import { NextRequest, NextResponse } from "next/server";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { verifyUserToken } from "@/lib/auth-rbac";
import { sendInstagramDirectReply } from "@/lib/instagram-direct-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { clientId?: unknown; text?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const text = typeof body?.text === "string" ? body.text : "";
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Немає клієнта." }, { status: 400 });
  }
  const result = await sendInstagramDirectReply(clientId, text);
  if (result.ok === false) {
    return NextResponse.json({ ok: false, error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
