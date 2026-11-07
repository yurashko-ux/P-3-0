// Нічний знімок залишків завдатків Altegio. Раз на добу: обхід клієнтів повільний.

import { NextRequest, NextResponse } from "next/server";
import { captureClientDepositSnapshot } from "@/lib/deposits/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = req.headers.get("authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  return Boolean(
    isVercelCron ||
      (cronSecret && (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret)),
  );
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, result: await captureClientDepositSnapshot() });
  } catch (err) {
    console.error("[cron/sync-client-deposits-snapshot] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка знімка завдатків" },
      { status: 500 },
    );
  }
}
