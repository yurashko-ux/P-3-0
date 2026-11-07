// Нічна звірка реєстру завдатків зі знімком Altegio. Лише читання: запис — кнопкою №109.
// Запитів до БД: 5 за запуск, раз на добу після знімка.

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
    const result = await syncDepositLedger();
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
