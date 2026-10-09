import { NextRequest, NextResponse } from "next/server";
import { listSavedCashCounts } from "@/lib/finance/cash-count";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || 300);
    const counts = await listSavedCashCounts(limit);
    return NextResponse.json({ ok: true, counts });
  } catch (err) {
    console.error("[api/admin/finance/kasa] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка списку касовок" },
      { status: 500 },
    );
  }
}
