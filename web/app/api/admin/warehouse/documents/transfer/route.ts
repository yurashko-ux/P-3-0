import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { createStorageTransfer } from "@/lib/warehouse/documents-kresco";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const createdBy = auth.type === "user" ? auth.login : "superadmin";
    const result = await createStorageTransfer({
      fromStorageId: String(body.fromStorageId || ""),
      toStorageId: String(body.toStorageId || ""),
      createdBy,
      lines: Array.isArray(body.lines) ? body.lines : [],
    });
    return NextResponse.json({
      ok: true,
      documentId: result.id,
    });
  } catch (err) {
    console.error("[api/admin/warehouse/documents/transfer] error:", err);
    const message = err instanceof Error ? err.message : "Помилка переміщення";
    const status = /вкажіть|оберіть|додайте|різні|лише|не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
