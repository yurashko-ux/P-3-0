import { NextRequest, NextResponse } from "next/server";
import { createFinanceExpenseGroup } from "@/lib/finance/documents-kresco";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

/** Створення групи розходу (кнопка «+ Група» у картці Розходу). */
export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const group = await createFinanceExpenseGroup({ title: body.title });
    return NextResponse.json({ ok: true, group: { id: group.id, title: group.title } });
  } catch (err) {
    console.error("[api/admin/finance/expense-groups] POST error:", err);
    const message = err instanceof Error ? err.message : "Не вдалося створити групу";
    const status = /вкажіть|вже є/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
