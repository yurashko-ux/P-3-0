import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  syncAltegioFinanceTransactions,
} from "@/lib/altegio/finance-transactions-sync";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Кнопка тягне лише останні 40 днів (включно з сьогодні) */
const PULL_ALL_DAYS = 40;

/** Перший день вікна: сьогодні − 39 днів, але не раніше ALTEGIO_FINANCE_SYNC_START_DATE */
function pullWindowStart(today: string): string {
  const start = new Date(new Date(`${today}T00:00:00Z`).getTime() - (PULL_ALL_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return start < ALTEGIO_FINANCE_SYNC_START_DATE ? ALTEGIO_FINANCE_SYNC_START_DATE : start;
}

/**
 * Кнопка «Підтягнути всі платежі»: фінансові операції Altegio за останні 40 днів
 * (не раніше ALTEGIO_FINANCE_SYNC_START_DATE). Клієнт викликає POST частинами по кілька днів,
 * щоб один запит не впирався в ліміт часу. Нічого не зводить — лише оновлює операції в базі.
 */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;
  const today = kyivCalendarTodayYmd();
  return NextResponse.json({ ok: true, startDate: pullWindowStart(today), today });
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const today = kyivCalendarTodayYmd();
  const requestedFrom = typeof body.dateFrom === "string" && YMD.test(body.dateFrom) ? body.dateFrom : null;
  const requestedTo = typeof body.dateTo === "string" && YMD.test(body.dateTo) ? body.dateTo : null;
  if (!requestedFrom || !requestedTo) {
    return NextResponse.json({ ok: false, error: "Потрібні dateFrom і dateTo (YYYY-MM-DD)" }, { status: 400 });
  }
  // Не тягнемо раніше 40-денного вікна (і раніше ALTEGIO_FINANCE_SYNC_START_DATE)
  const windowStart = pullWindowStart(today);
  const dateFrom = requestedFrom < windowStart ? windowStart : requestedFrom;
  const dateTo = requestedTo > today ? today : requestedTo;
  if (dateFrom > dateTo) {
    return NextResponse.json({ ok: true, dateFrom, dateTo, fetched: 0, upserted: 0 });
  }

  console.log("[payment-reconciliation/pull-altegio-all] Підтягуємо операції Altegio", { dateFrom, dateTo });
  try {
    const result = await syncAltegioFinanceTransactions({ dateFrom, dateTo, syncPurposes: true });
    console.log("[payment-reconciliation/pull-altegio-all] Готово", {
      dateFrom,
      dateTo,
      fetched: result.fetched,
      upserted: result.upserted,
    });
    return NextResponse.json({ ok: true, dateFrom, dateTo, fetched: result.fetched, upserted: result.upserted });
  } catch (error) {
    console.error("[payment-reconciliation/pull-altegio-all] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося підтягнути платежі з Altegio" },
      { status: 500 },
    );
  }
}
