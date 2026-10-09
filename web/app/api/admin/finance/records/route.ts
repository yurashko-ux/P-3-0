import { NextRequest, NextResponse } from "next/server";
import { listKrescoRecords } from "@/lib/finance/kresco-records";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || 200);
    const records = await listKrescoRecords(limit);
    return NextResponse.json({ ok: true, records });
  } catch (err) {
    console.error("[api/admin/finance/records] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка списку записів" },
      { status: 500 },
    );
  }
}
