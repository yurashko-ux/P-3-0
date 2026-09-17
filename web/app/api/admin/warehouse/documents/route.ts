import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { listWarehouseDocuments, getWarehouseDocument } from "@/lib/warehouse/documents-kresco";

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
      return NextResponse.json({ ok: true, document });
    }
    const rows = await listWarehouseDocuments({
      q: String(req.nextUrl.searchParams.get("q") || ""),
      type: String(req.nextUrl.searchParams.get("type") || ""),
    });
    const documents = rows.map((row) => {
      const invoice = Number(row.invoiceAmount) || 0;
      return {
        id: row.id,
        type: row.type,
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
