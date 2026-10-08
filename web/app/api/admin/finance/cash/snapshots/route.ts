import { NextRequest, NextResponse } from "next/server";
import { listCashDaySnapshots } from "@/lib/finance/cash-count";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const snapshots = await listCashDaySnapshots();
    return NextResponse.json({ ok: true, snapshots });
  } catch (err) {
    console.error("[api/admin/finance/cash/snapshots] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка знімків каси" },
      { status: 500 },
    );
  }
}
