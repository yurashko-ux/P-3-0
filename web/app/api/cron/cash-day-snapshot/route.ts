// Опівночі за Києвом (21:00 UTC) фіксує знімок усіх плиток Каси за день, що закінчився.

import { NextRequest, NextResponse } from "next/server";
import { captureCashDaySnapshot } from "@/lib/finance/cash-count";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function okCron(req: NextRequest): boolean {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  if (isVercelCron) return true;
  const envSecret = process.env.CRON_SECRET || "";
  const urlSecret = req.nextUrl.searchParams.get("secret");
  if (envSecret && urlSecret && envSecret === urlSecret) return true;
  const authHeader = req.headers.get("authorization");
  if (envSecret && authHeader === `Bearer ${envSecret}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    const dayParam = (req.nextUrl.searchParams.get("day") || "").trim();
    const result = await captureCashDaySnapshot(dayParam || undefined);
    console.log("[cron/cash-day-snapshot]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/cash-day-snapshot]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка знімка каси" },
      { status: 500 },
    );
  }
}
