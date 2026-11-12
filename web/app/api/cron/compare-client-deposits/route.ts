// Нічна звірка реєстру завдатків зі знімком Altegio. До старту (кнопка №109) — лише читання;
// після старту доносить у реєстр поповнення й чеки, зроблені в Altegio, і позначає розбіжності.
// Запитів до БД: 5 читань + записи лише для нових рухів і змінених рахунків, раз на добу після знімка.

import { NextRequest, NextResponse } from "next/server";
import { syncDepositLedger } from "@/lib/deposits/ledger-sync";

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
    const result = await syncDepositLedger({ applyIfAnchored: true });
    console.log("[cron/compare-client-deposits] Звірка реєстру", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/compare-client-deposits] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка звірки завдатків" },
      { status: 500 },
    );
  }
}
