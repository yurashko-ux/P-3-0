import { NextRequest, NextResponse } from "next/server";
import { processPendingNotionEvents } from "@/lib/notion/process-event";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = req.headers.get("authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  return Boolean(cronSecret && (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret));
}

export async function GET(req: NextRequest) {
  return POST(req);
}

/** Кожні 5 хвилин добирає події Notion, які не встигла обробити відповідь вебхука. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const processed = await processPendingNotionEvents();
    console.log("[cron/notion-notifications] перевірено чергу", { processed });
    return NextResponse.json({ ok: true, processed });
  } catch (error) {
    console.error("[cron/notion-notifications] помилка", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка черги Notion" },
      { status: 500 },
    );
  }
}
