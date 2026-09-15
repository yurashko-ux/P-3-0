import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { createInventory } from "@/lib/warehouse/documents-kresco";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const createdBy = auth.type === "user" ? auth.login : "superadmin";
    const result = await createInventory({
      storageId: String(body.storageId || ""),
      title: String(body.title || "Інвентаризація складу"),
      occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
      createdBy,
      lines: Array.isArray(body.lines) ? body.lines : [],
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/admin/warehouse/documents/inventory] error:", err);
    const message = err instanceof Error ? err.message : "Помилка інвентаризації";
    const status = /вкажіть|додайте|не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
