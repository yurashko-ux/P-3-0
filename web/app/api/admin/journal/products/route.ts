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

/**
 * Товари для картки запису: реальні залишки зі складу «Товари» (як у розділі Склад).
 * Беремо рядки stock з quantity > 0, без штучного ліміту 120 карток.
 */
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
        groups: [],
        storage: null,
        storages: [],
        errorHint: "Немає складу «Товари»",
      });
    }

    const skuNum = Number(q);
    const hasQuery = q.length >= 1;

    const stockRows = await prisma.warehouseStock.findMany({
      where: {
        storageId: goodsStorage.id,
        quantity: { gt: 0 },
        product: {
          isActive: true,
          ...(hasQuery
            ? {
                OR: [
                  ...(Number.isFinite(skuNum) && skuNum > 0
                    ? [{ sku: skuNum }, { altegioGoodId: skuNum }]
                    : []),
                  { title: { contains: q, mode: "insensitive" } },
                  { category: { contains: q, mode: "insensitive" } },
                  { group: { title: { contains: q, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
      },
      include: {
        product: {
          include: { group: { select: { id: true, title: true } } },
        },
      },
      orderBy: [{ product: { title: "asc" } }],
    });

    // Один продукт може мати кілька рядків stock — агрегуємо quantity.
    const byProduct = new Map<
      string,
      {
        id: string;
        title: string;
        salePrice: number;
        costPerUnit: number;
        priceIsCost: boolean;
        altegioGoodId: number | null;
        isHair: boolean;
        sku: number | null;
        stockQty: number;
        unit: string;
        storageId: string;
        category: string;
        groupId: string | null;
      }
    >();

    for (const row of stockRows) {
      const p = row.product;
      if (!p) continue;
      const qty = Number(row.quantity) || 0;
      if (qty <= 0) continue;
      const existing = byProduct.get(p.id);
      if (existing) {
        existing.stockQty += qty;
        continue;
      }
      const sale = Number(p.salePrice) || 0;
      const cost = Number(p.costPerUnit) || Number(row.costPerUnit) || 0;
      const displayPrice = sale > 0 ? sale : cost;
      byProduct.set(p.id, {
        id: p.id,
        title: p.title,
        salePrice: displayPrice,
        costPerUnit: cost,
        priceIsCost: sale <= 0 && cost > 0,
        altegioGoodId: p.altegioGoodId,
        isHair: p.isHair,
        sku: p.sku,
        stockQty: qty,
        unit: "шт.",
        storageId: goodsStorage.id,
        category: p.group?.title || p.category || "Інше",
        groupId: p.group?.id || null,
      });
    }

    const mapped = [...byProduct.values()].sort((a, b) => {
      const cat = a.category.localeCompare(b.category, "uk");
      if (cat !== 0) return cat;
      return a.title.localeCompare(b.title, "uk");
    });

    const groupMap = new Map<
      string,
      { title: string; stockQty: number; products: typeof mapped }
    >();
    for (const p of mapped) {
      const title = p.category || "Інше";
      const hit = groupMap.get(title) || { title, stockQty: 0, products: [] };
      hit.products.push(p);
      hit.stockQty += p.stockQty;
      groupMap.set(title, hit);
    }
    const groups = [...groupMap.values()].sort((a, b) => {
      const aK = /хвости/i.test(a.title) ? 0 : 1;
      const bK = /хвости/i.test(b.title) ? 0 : 1;
      if (aK !== bK) return aK - bK;
      return a.title.localeCompare(b.title, "uk");
    });

    console.log(
      `[api/admin/journal/products] Склад «${goodsStorage.title}»: ${mapped.length} товарів, ` +
        `сумма шт=${mapped.reduce((a, p) => a + p.stockQty, 0)}` +
        (hasQuery ? `, q="${q}"` : ""),
    );

    return NextResponse.json({
      ok: true,
      products: mapped,
      groups,
      storage: goodsStorage,
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
