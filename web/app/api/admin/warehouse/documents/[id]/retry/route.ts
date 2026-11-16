import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWarehouseSection, requireWarehouseWriteOff } from "@/lib/warehouse/require-warehouse-auth";
import { retryWarehouseDocumentSync } from "@/lib/warehouse/documents-kresco";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  // Повтор запису списання в Altegio — теж лише з правом списання
  const target = await prisma.warehouseDocument.findUnique({ where: { id: params.id }, select: { type: true } });
  if (target?.type === "write_off") {
    const writeOffAuth = await requireWarehouseWriteOff(req);
    if (writeOffAuth instanceof NextResponse) return writeOffAuth;
  }

  try {
    const document = await retryWarehouseDocumentSync(params.id);
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    console.error("[api/admin/warehouse/documents/retry] error:", err);
    const message = err instanceof Error ? err.message : "Помилка повторної синхронізації";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
