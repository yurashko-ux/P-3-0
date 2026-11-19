// Щовечірній знімок обігових коштів для графіка дашборду. Раз на добу, ~10 запитів до БД за запуск.

import { NextRequest, NextResponse } from "next/server";
import { captureWorkingCapitalSnapshot } from "@/lib/dashboard/working-capital";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
    return NextResponse.json(await captureWorkingCapitalSnapshot());
  } catch (err) {
    console.error("[cron/capture-working-capital] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка знімка обігових коштів" },
      { status: 500 },
    );
  }
}
