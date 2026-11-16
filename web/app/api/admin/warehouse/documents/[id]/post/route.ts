import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWarehouseSection, requireWarehouseWriteOff } from "@/lib/warehouse/require-warehouse-auth";
import { postWarehouseDocument } from "@/lib/warehouse/documents-kresco";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Проведення документа: міняє залишки і пише прийомку/списання в Altegio. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  // Створити списання може будь-хто з доступом до Складу, провести — лише з правом «Склад: проводити списання»
  const target = await prisma.warehouseDocument.findUnique({ where: { id: params.id }, select: { type: true } });
  if (target?.type === "write_off") {
    const writeOffAuth = await requireWarehouseWriteOff(req);
    if (writeOffAuth instanceof NextResponse) return writeOffAuth;
  }

  try {
    const postedBy = auth.type === "user" ? auth.login : "superadmin";
    const document = await postWarehouseDocument(params.id, postedBy);
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    console.error("[api/admin/warehouse/documents/post] error:", err);
    const message = err instanceof Error ? err.message : "Помилка проведення";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
