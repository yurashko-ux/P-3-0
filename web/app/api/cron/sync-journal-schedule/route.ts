// Cron: графік змін Altegio → Kresco (поточний і наступний місяці), поки адміни можуть правити його в Altegio.

import { NextRequest, NextResponse } from "next/server";
import { syncWorkScheduleFromAltegio } from "@/lib/journal/work-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function okCron(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const envSecret = process.env.CRON_SECRET || "";
  return Boolean(envSecret) && req.nextUrl.searchParams.get("secret") === envSecret;
}

export async function GET(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
    const stats = await syncWorkScheduleFromAltegio(from, to);
    console.log("[cron/sync-journal-schedule] Готово:", stats);
    return NextResponse.json({ ok: true, from, to, ...stats });
  } catch (err) {
    console.error("[cron/sync-journal-schedule] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
