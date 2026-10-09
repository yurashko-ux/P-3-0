import { NextRequest, NextResponse } from "next/server";
import { deleteCashTillCount, listSavedCashCounts } from "@/lib/finance/cash-count";
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

export async function DELETE(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const id = (req.nextUrl.searchParams.get("id") || "").trim();
    await deleteCashTillCount(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/finance/kasa] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Не вдалося видалити касовку";
    const status = /немає id|не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
