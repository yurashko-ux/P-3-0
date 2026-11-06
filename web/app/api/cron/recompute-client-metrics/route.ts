// Cron: перерахунок visits / spent / lastVisitAt клієнтів із журналу і чеків Kresco (раз на годину).

import { NextRequest, NextResponse } from "next/server";
import { recomputeClientMetrics } from "@/lib/direct-client-metrics";

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
    const stats = await recomputeClientMetrics();
    console.log("[cron/recompute-client-metrics] Готово:", stats);
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/recompute-client-metrics] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
