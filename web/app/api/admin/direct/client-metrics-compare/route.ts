// Звірка метрик клієнтів: Kresco (база + журнал) проти контрольних значень Altegio.

import { NextRequest, NextResponse } from "next/server";
import { compareClientMetrics } from "@/lib/direct-client-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET && req.nextUrl.searchParams.get("secret") === CRON_SECRET) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await compareClientMetrics()) });
}
