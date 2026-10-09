import { NextRequest, NextResponse } from "next/server";
import { saveCashTillCount } from "@/lib/finance/cash-count";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const saved = await saveCashTillCount({
      accountId: Number(body.accountId) || 0,
      lines: body.lines,
      createdBy: auth.type === "user" ? auth.userId : auth.type,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    console.error("[api/admin/finance/cash/count] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка касовки";
    const status = /немає id|номінал|кількість|лише для|немає балансу/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
