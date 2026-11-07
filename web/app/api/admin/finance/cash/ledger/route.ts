import { NextRequest, NextResponse } from "next/server";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import { listCashLedger } from "@/lib/finance/cash-posting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Готівкові платежі і касовка, якою їх проведено. */
export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
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
