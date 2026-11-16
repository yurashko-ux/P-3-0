import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { createGoodsIntake, resolveHairStorageId } from "@/lib/warehouse/documents-kresco";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const createdBy = auth.type === "user" ? auth.login : "superadmin";
    // Волосся приймаємо лише прийомкою волосся
    if (String(body.storageId || "") === (await resolveHairStorageId())) {
      return NextResponse.json({ ok: false, error: "На склад волосся — через прийомку волосся" }, { status: 400 });
    }
    const document = await createGoodsIntake({
      storageId: String(body.storageId || ""),
      title: String(body.title || ""),
      currencyCode: String(body.currencyCode || "UAH"),
      invoiceAmount: Number(body.invoiceAmount),
      deliveryAmount: Number(body.deliveryAmount) || 0,
      occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
      createdBy,
      // Створюємо чернетку — залишки й Altegio міняє лише проведення
      draft: true,
      replaceDocumentId: typeof body.replaceDocumentId === "string" && body.replaceDocumentId ? body.replaceDocumentId : undefined,
      lines: Array.isArray(body.lines) ? body.lines : [],
    });
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    console.error("[api/admin/warehouse/documents/goods] error:", err);
    const message = err instanceof Error ? err.message : "Помилка прийомки товару";
    const status = /вкажіть|додайте|увімкнен|не знайдено|два слова/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
