import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { syncAltegioFinanceTransactions } from "@/lib/altegio/finance-transactions-sync";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ручне підтягування фінансових операцій Altegio лише за поточний день (Europe/Kyiv).
 * Історію з 2026-06-15 і банківські виписки не чіпаємо.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const day = kyivCalendarTodayYmd();
  console.log("[api/admin/finance/cash/pull-today] Підтягуємо рахунки Altegio за день", { day });

  try {
    const result = await syncAltegioFinanceTransactions({
      dateFrom: day,
      dateTo: day,
      syncPurposes: false,
    });
    console.log("[api/admin/finance/cash/pull-today] Готово", {
      day,
      fetched: result.fetched,
      upserted: result.upserted,
    });
    return NextResponse.json({
      ok: true,
      day: result.dateFrom,
      fetched: result.fetched,
      upserted: result.upserted,
    });
  } catch (error) {
    console.error("[api/admin/finance/cash/pull-today] POST error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Не вдалося підтягнути рахунки з Altegio",
      },
      { status: 500 },
    );
  }
}
