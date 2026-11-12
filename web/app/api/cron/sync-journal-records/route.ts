import { NextRequest, NextResponse } from "next/server";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { retryPendingAltegioMirrors, syncJournalAppointmentsFromAltegio } from "@/lib/journal";

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
    // Повний діапазон (1-ше … +36 міс) лише 00:00–00:30 UTC; інакше −3…+90 днів.
    // Пишемо в Prisma лише нові/змінені записи (див. syncAppointmentsRangeFromAltegio).
    console.log("[cron/sync-journal-records] Старт синку журналу з Altegio");
    const result = await syncJournalAppointmentsFromAltegio();
    console.log("[cron/sync-journal-records] Готово", result);
    // Записи, що лишились лише в Kresco через збій Altegio, дублюємо повтором (небагато за раз).
    const mirrorRetry = await retryPendingAltegioMirrors().catch((err) => {
      console.error("[cron/sync-journal-records] Повтор дубля в Altegio не вдався:", err);
      return null;
    });
    return NextResponse.json({ ok: true, result, mirrorRetry, today: kyivCalendarTodayYmd() });
  } catch (err) {
    console.error("[cron/sync-journal-records] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
