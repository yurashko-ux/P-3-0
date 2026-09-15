import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { importWarehouseFromAltegio } from "@/lib/warehouse/import-from-altegio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const createdBy = auth.type === "user" ? auth.login : "superadmin";
    console.log(`[api/admin/warehouse/import] Старт імпорту з Altegio, user=${createdBy}`);
    const result = await importWarehouseFromAltegio({ createdBy });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/admin/warehouse/import] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка імпорту складу з Altegio" },
      { status: 500 },
    );
  }
}
