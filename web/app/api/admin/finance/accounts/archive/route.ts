import { NextRequest, NextResponse } from "next/server";
import { setFinanceAccountHidden } from "@/lib/finance/account-archive";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const hidden = Boolean(body.hidden);
    await setFinanceAccountHidden({
      accountId: Number(body.accountId) || 0,
      title: typeof body.title === "string" ? body.title : null,
      hidden,
      hiddenBy: auth.type === "user" ? auth.userId : auth.type,
    });
    return NextResponse.json({ ok: true, hidden });
  } catch (err) {
    console.error("[api/admin/finance/accounts/archive] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка архіву рахунку";
    const status = /немає id/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
