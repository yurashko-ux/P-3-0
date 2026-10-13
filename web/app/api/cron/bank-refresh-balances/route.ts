import { NextRequest, NextResponse } from "next/server";
import { refreshAllMonobankAccountBalances } from "@/lib/bank/refresh-monobank-balances";

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

/** Щоночі о 02:00 Europe/Kyiv: поточні баланси всіх рахунків Monobank. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const connections = await refreshAllMonobankAccountBalances();
    const updated = connections.reduce((sum, connection) => sum + connection.updated, 0);
    const failed = connections.filter((connection) => connection.error).length;
    console.log("[cron/bank-refresh-balances] Завершено", {
      connections: connections.length,
      updated,
      failed,
    });
    return NextResponse.json({ ok: failed === 0, connections, updated, failed });
  } catch (error) {
    console.error("[cron/bank-refresh-balances] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка нічного оновлення балансів" },
      { status: 500 },
    );
  }
}
