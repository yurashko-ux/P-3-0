import { NextRequest, NextResponse } from "next/server";
import { listCashBalances } from "@/lib/finance/cash-balances";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const tiles = await listCashBalances();
    return NextResponse.json({ ok: true, tiles });
  } catch (err) {
    console.error("[api/admin/finance/cash] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка залишків каси" },
      { status: 500 },
    );
  }
}
