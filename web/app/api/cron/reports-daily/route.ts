// Cron: щоденний операційний звіт у Telegram (~21:00 Kyiv).

import { NextRequest, NextResponse } from "next/server";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import { deliverDailyReport } from "@/lib/reports/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function okCron(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return Boolean(envSecret && urlSecret && envSecret === urlSecret);
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  console.log("[cron/reports-daily] POST request received");

  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const dayParam = req.nextUrl.searchParams.get("day");
    const kyivDay = getTodayKyiv(dayParam);
    const result = await deliverDailyReport({ kyivDay });

    console.log("[cron/reports-daily] Done:", {
      kyivDay: result.kyivDay,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
    });

    return NextResponse.json({
      ok: result.ok,
      kyivDay: result.kyivDay,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
      errors: result.errors,
    });
  } catch (error) {
    console.error("[cron/reports-daily] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
