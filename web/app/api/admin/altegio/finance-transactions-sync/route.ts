import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  syncAltegioFinanceTransactions,
} from "@/lib/altegio/finance-transactions-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : ALTEGIO_FINANCE_SYNC_START_DATE;
    const dateTo = typeof body.dateTo === "string" ? body.dateTo : undefined;
    const maxPages = typeof body.maxPages === "number" ? body.maxPages : undefined;

    const result = await syncAltegioFinanceTransactions({
      dateFrom,
      dateTo,
      maxPages,
      syncPurposes: true,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[admin/altegio/finance-transactions-sync] Помилка sync:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка синхронізації фінансових транзакцій Altegio" },
      { status: 500 },
    );
  }
}
