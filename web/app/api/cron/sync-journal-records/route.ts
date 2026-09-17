import { NextRequest, NextResponse } from "next/server";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { syncAppointmentsRangeFromAltegio } from "@/lib/journal";

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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function shiftKyivYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta, 12));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const today = kyivCalendarTodayYmd();
    const startDate = shiftKyivYmd(today, -1);
    const endDate = shiftKyivYmd(today, 7);
    console.log(`[cron/sync-journal-records] Старт ${startDate}…${endDate}`);
    const result = await syncAppointmentsRangeFromAltegio({ startDate, endDate });
    console.log("[cron/sync-journal-records] Готово", result);
    return NextResponse.json({ ok: true, startDate, endDate, result, today: kyivCalendarTodayYmd() });
  } catch (err) {
    console.error("[cron/sync-journal-records] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
