import { NextRequest, NextResponse } from "next/server";
import { deleteVisitPayment, updateVisitPayment } from "@/lib/finance/visit-payments";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

function statusFor(message: string): number {
  return /зведено|оберіть|сума|не знайден|вкажіть/i.test(message) ? 400 : 500;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    await updateVisitPayment({
      id: params.id,
      accountId: Number(body.accountId) || 0,
      amountUah: Number(body.amountUah) || 0,
      amountFx: body.amountFx == null || body.amountFx === "" ? null : Number(body.amountFx),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/finance/visit-payments/:id] PATCH error:", err);
    const message = err instanceof Error ? err.message : "Помилка збереження платежу";
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteVisitPayment(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/finance/visit-payments/:id] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Помилка видалення платежу";
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}
