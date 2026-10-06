import { NextRequest, NextResponse } from "next/server";
import { runAltegioArchiveSlice } from "@/lib/altegio/archive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = req.headers.get("authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  return Boolean(isVercelCron || (cronSecret && (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret)));
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAltegioArchiveSlice();
    console.log("[cron/sync-altegio-archive] Крок", result.step);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/sync-altegio-archive] Помилка:", err);
    const message = err instanceof Error ? err.message : "Помилка архіву";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
