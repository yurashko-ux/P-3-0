import { NextRequest, NextResponse } from "next/server";
import { importWarehouseFromAltegio } from "@/lib/warehouse/import-from-altegio";

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
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[cron/sync-warehouse-mirror] Старт дзеркала складу з Altegio");
    const result = await importWarehouseFromAltegio({ createdBy: "cron" });
    console.log("[cron/sync-warehouse-mirror] Готово", result);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[cron/sync-warehouse-mirror] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
