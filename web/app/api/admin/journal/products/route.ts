import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { searchWarehouseProducts } from "@/lib/warehouse/catalog";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Пошук товарів для картки запису (право journal, не warehouse). */
export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const q = String(req.nextUrl.searchParams.get("q") || "").trim();
    const [products, storages] = await Promise.all([
      q.length >= 1 ? searchWarehouseProducts(q) : Promise.resolve([]),
      prisma.warehouseStorage.findMany({
        where: { isActive: true },
        orderBy: { title: "asc" },
        select: { id: true, title: true },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      products: (products || []).slice(0, 40).map((p: any) => ({
        id: p.id,
        title: p.title,
        salePrice: p.salePrice,
        altegioGoodId: p.altegioGoodId,
        isHair: p.isHair,
        sku: p.sku,
      })),
      storages,
    });
  } catch (err) {
    console.error("[api/admin/journal/products] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка товарів" },
      { status: 500 },
    );
  }
}
