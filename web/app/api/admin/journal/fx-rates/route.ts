import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { getOrFixDailyFxRates } from "@/lib/fx/daily-rates";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/journal/fx-rates?day=YYYY-MM-DD
 * Денний робочий курс (Monobank rateSell → ceil+1), фіксація на день Europe/Kyiv.
 * Повний URL: https://p-3-0.vercel.app/api/admin/journal/fx-rates
 */
export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const rawDay = String(req.nextUrl.searchParams.get("day") || "").trim();
    const day = rawDay || kyivCalendarTodayYmd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json(
        { ok: false, error: "Некоректна дата day (YYYY-MM-DD)", rates: null },
        { status: 400 },
      );
    }

    const rates = await getOrFixDailyFxRates(day);
    if (!rates) {
      console.log(`[api/admin/journal/fx-rates] Немає курсу для ${day}`);
      return NextResponse.json(
        {
          ok: false,
          error: "Немає зафіксованого курсу за цей день",
          rates: null,
          kyivDay: day,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      kyivDay: rates.kyivDay,
      usdSell: rates.usdSell,
      eurSell: rates.eurSell,
      usdWorking: rates.usdWorking,
      eurWorking: rates.eurWorking,
      source: rates.source,
      fetchedAt: rates.fetchedAt,
      fixed: rates.fixed,
      rates,
    });
  } catch (err) {
    console.error("[api/admin/journal/fx-rates] GET error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Помилка денного курсу",
        rates: null,
      },
      { status: 500 },
    );
  }
}
