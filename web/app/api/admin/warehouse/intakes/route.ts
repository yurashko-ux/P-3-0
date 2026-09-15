import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { createWarehouseIntake } from "@/lib/warehouse/documents";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const createdBy = auth.type === "user" ? auth.login : "superadmin";
    const document = await createWarehouseIntake({
      storageId: String(body.storageId || ""),
      comment: typeof body.comment === "string" ? body.comment : undefined,
      occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
      createdBy,
      lines: Array.isArray(body.lines) ? body.lines : [],
    });
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    console.error("[api/admin/warehouse/intakes] error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення прийомки";
    const status = message.includes("не знайдено") || message.includes("Додайте") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
