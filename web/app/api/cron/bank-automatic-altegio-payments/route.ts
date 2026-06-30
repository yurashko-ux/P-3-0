import { NextRequest, NextResponse } from "next/server";
import { runAutomaticAltegioPayments } from "@/lib/bank/automatic-altegio-payments";

export const dynamic = "force-dynamic";
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

/** Cron: автоматичні платежі Altegio (еквайринг fallback + термінал щомісяця). */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAutomaticAltegioPayments({
      acquiring: true,
      terminal: true,
      lookbackDays: 14,
      sendTelegram: true,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/bank-automatic-altegio-payments] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка cron автоматичних платежів" },
      { status: 500 },
    );
  }
}
