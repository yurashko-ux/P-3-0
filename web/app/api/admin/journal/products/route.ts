import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Склад «Товари» (не «Витратні матеріали»). */
async function resolveGoodsStorageId(): Promise<{ id: string; title: string } | null> {
  const exact = await prisma.warehouseStorage.findFirst({
    where: { isActive: true, title: { equals: "Товари", mode: "insensitive" } },
    select: { id: true, title: true },
  });
  if (exact) return exact;
  const soft = await prisma.warehouseStorage.findFirst({
    where: {
      isActive: true,
      title: { contains: "Товар", mode: "insensitive" },
      NOT: { title: { contains: "Витратн", mode: "insensitive" } },
    },
    select: { id: true, title: true },
  });
  return soft;
}

/** Пошук товарів для картки запису: лише склад «Товари», залишок > 0. */
export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const q = String(req.nextUrl.searchParams.get("q") || "").trim();
    const goodsStorage = await resolveGoodsStorageId();
    if (!goodsStorage) {
      console.warn('[api/admin/journal/products] Немає активного складу «Товари»');
      return NextResponse.json({
        ok: true,
        products: [],
        storage: null,
        storages: [],
        errorHint: "Немає складу «Товари»",
      });
    }

    const skuNum = Number(q);
    const hasQuery = q.length >= 1;
    const products = await prisma.warehouseProduct.findMany({
      where: {
        isActive: true,
        ...(hasQuery
          ? {
              OR: [
                ...(Number.isFinite(skuNum) && skuNum > 0
                  ? [{ sku: skuNum }, { altegioGoodId: skuNum }]
                  : []),
                { title: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        group: { select: { id: true, title: true } },
        stocks: {
          where: { storageId: goodsStorage.id },
          select: { quantity: true, storageId: true },
        },
      },
      orderBy: [{ category: "asc" }, { title: "asc" }],
      take: hasQuery ? 150 : 300,
    });

    const mapped = products
      .map((p) => {
        const stockQty = (p.stocks || []).reduce((a, s) => a + (Number(s.quantity) || 0), 0);
        const sale = Number(p.salePrice) || 0;
        const cost = Number(p.costPerUnit) || 0;
        const displayPrice = sale > 0 ? sale : cost;
        return {
          id: p.id,
          title: p.title,
          salePrice: displayPrice,
          costPerUnit: cost,
          priceIsCost: sale <= 0 && cost > 0,
          altegioGoodId: p.altegioGoodId,
          isHair: p.isHair,
          sku: p.sku,
          stockQty,
          unit: "шт.",
          storageId: goodsStorage.id,
          category: p.group?.title || p.category || "Інше",
          groupId: p.group?.id || null,
        };
      })
      .filter((p) => p.stockQty > 0)
      .slice(0, 120);

    // Групи для UI як у Altegio (аккордеон категорій)
    const groupMap = new Map<string, { title: string; products: typeof mapped }>();
    for (const p of mapped) {
      const title = p.category || "Інше";
      const hit = groupMap.get(title) || { title, products: [] };
      hit.products.push(p);
      groupMap.set(title, hit);
    }
    const groups = [...groupMap.values()].sort((a, b) => a.title.localeCompare(b.title, "uk"));

    return NextResponse.json({
      ok: true,
      products: mapped,
      groups,
      storage: goodsStorage,
      // зворотна сумісність: один склад
      storages: [goodsStorage],
    });
  } catch (err) {
    console.error("[api/admin/journal/products] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка товарів" },
      { status: 500 },
    );
  }
}
