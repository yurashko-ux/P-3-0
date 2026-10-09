import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { listCashLedger } from "@/lib/finance/cash-posting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Готівкові платежі і касовка, якою їх проведено. */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const rows = await listCashLedger();
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    console.error("[api/admin/finance/cash/ledger] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити готівку" },
      { status: 500 },
    );
  }
}
