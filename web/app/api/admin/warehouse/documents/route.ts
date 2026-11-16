import { NextRequest, NextResponse } from "next/server";
import { canEdit } from "@/lib/auth-rbac";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { deleteWarehouseDocument, listWarehouseDocuments, getWarehouseDocument, warehouseDocumentNumbers } from "@/lib/warehouse/documents-kresco";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const document = await getWarehouseDocument(id);
      if (!document) {
        return NextResponse.json({ ok: false, error: "Документ не знайдено" }, { status: 404 });
      }
      const numbers = await warehouseDocumentNumbers();
      return NextResponse.json({ ok: true, document: { ...document, number: numbers.get(document.id) ?? null } });
    }
    const rows = await listWarehouseDocuments({
      q: String(req.nextUrl.searchParams.get("q") || ""),
      type: String(req.nextUrl.searchParams.get("type") || ""),
    });
    const numbers = await warehouseDocumentNumbers();
    const documents = rows.map((row) => {
      const invoice = Number(row.invoiceAmount) || 0;
      return {
        id: row.id,
        number: numbers.get(row.id) ?? null,
        type: row.type,
        // Списання з оплати запису в журналі — це продаж
        isSale: Boolean(row.salonCheckout),
        kind: row.kind,
        status: row.status,
        syncStatus: row.syncStatus,
        syncError: row.syncError,
        title: row.title || row.comment || row.type,
        kyivDay: row.kyivDay,
        occurredAt: row.occurredAt,
        currencyCode: row.currencyCode,
        invoiceAmount: invoice,
        deliveryAmount: Number(row.deliveryAmount) || 0,
        weightMismatch: row.weightMismatch,
        weightDeltaGrams: row.weightDeltaGrams,
        fxRateUsdUah: row.fxRateUsdUah,
        createdBy: row.createdBy,
        storageTitle:
          row.type === "transfer"
            ? `${row.fromStorage?.title || "?"} → ${row.toStorage?.title || "?"}`
            : row.toStorage?.title || row.fromStorage?.title || "",
        linesCount: row.lines.length,
        children: row.children,
      };
    });
    return NextResponse.json({ ok: true, documents });
  } catch (err) {
    console.error("[api/admin/warehouse/documents] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка списку документів" },
      { status: 500 },
    );
  }
}

/** Видалення документа — суперадмін або посада з правом «Склад: видаляти документи». */
export async function DELETE(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  if (auth.type !== "superadmin" && !canEdit(auth.permissions, "warehouseDeleteDocs")) {
    return NextResponse.json({ ok: false, error: "Немає права видаляти документи складу" }, { status: 403 });
  }

  try {
    const id = String(req.nextUrl.searchParams.get("id") || "");
    if (!id) return NextResponse.json({ ok: false, error: "Не вказано документ" }, { status: 400 });
    const document = await deleteWarehouseDocument(id, auth.type === "user" ? auth.login : "superadmin");
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    console.error("[api/admin/warehouse/documents] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Помилка видалення документа";
    return NextResponse.json({ ok: false, error: message }, { status: /не знайдено|лише/i.test(message) ? 400 : 500 });
  }
}
