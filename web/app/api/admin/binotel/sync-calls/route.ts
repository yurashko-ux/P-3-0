// web/app/api/admin/binotel/sync-calls/route.ts
// Синхронізація історії дзвінків з Binotel в Direct

import { NextRequest, NextResponse } from "next/server";
import { syncBinotelCallsToDb } from "@/lib/binotel/sync-calls";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const daysBack = parseInt(req.nextUrl.searchParams.get("daysBack") || "7", 10) || 7;
  const clampedDays = Math.min(Math.max(daysBack, 1), 30);
  const maxCalls = parseInt(req.nextUrl.searchParams.get("maxCalls") || "80", 10) || 80;
  const clampedMaxCalls = Math.min(Math.max(maxCalls, 1), 500);

  const now = Math.floor(Date.now() / 1000);
  const startTime = now - clampedDays * 24 * 60 * 60;

  try {
    const result = await syncBinotelCallsToDb(startTime, now, clampedMaxCalls);

    return NextResponse.json({
      ok: true,
      daysBack: clampedDays,
      maxCalls: clampedMaxCalls,
      period: {
        start: new Date(startTime * 1000).toISOString(),
        end: new Date(now * 1000).toISOString(),
      },
      ...result,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "Помилка синхронізації Binotel",
      details: msg,
    });
  }
}
