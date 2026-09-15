import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { getNativeWarehouseBalance } from "@/lib/warehouse/stock";
import { getPreviousMonth, getWarehouseBalanceForReportMonth } from "@/lib/finance/warehouse-balance";

export const dynamic = "force-dynamic";

function roundPurchaseSuggestion(raw: number): number {
  if (!(raw > 0)) return 0;
  return Math.ceil(raw / 10000) * 10000;
}

export async function GET(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const hairOnly = req.nextUrl.searchParams.get("hair") === "1";
    const q = String(req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

    const [balance, storages, products, documents, stocks] = await Promise.all([
      getNativeWarehouseBalance(),
      prisma.warehouseStorage.findMany({
        where: { isActive: true },
        orderBy: { title: "asc" },
      }),
      prisma.warehouseProduct.findMany({
        where: { isActive: true, ...(hairOnly ? { isHair: true } : {}) },
        orderBy: [{ isHair: "desc" }, { title: "asc" }],
      }),
      prisma.warehouseDocument.findMany({
        where: { status: "posted" },
        include: {
          toStorage: { select: { title: true } },
          fromStorage: { select: { title: true } },
          lines: { include: { product: { select: { title: true, isHair: true } } } },
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 50,
      }),
      prisma.warehouseStock.findMany({
        include: {
          product: true,
          storage: true,
        },
        orderBy: [{ quantity: "desc" }],
      }),
    ]);

    const filteredStocks = stocks.filter((row) => {
      if (hairOnly && !row.product.isHair) return false;
      if (!q) return true;
      const hay = `${row.product.title} ${row.product.category || ""} ${row.storage.title}`.toLowerCase();
      return hay.includes(q);
    });

    const filteredProducts = products.filter((p) => {
      if (!q) return true;
      const hay = `${p.title} ${p.category || ""}`.toLowerCase();
      return hay.includes(q);
    });

    const outOfStockHair = products.filter((p) => {
      if (!p.isHair) return false;
      const qty = stocks
        .filter((s) => s.productId === p.id)
        .reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
      return qty <= 0;
    });

    const now = new Date();
    const kyivParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(now);
    const year = Number(kyivParts.find((p) => p.type === "year")?.value || 0);
    const month = Number(kyivParts.find((p) => p.type === "month")?.value || 0);
    const prev = getPreviousMonth(year, month);
    const previous = await getWarehouseBalanceForReportMonth(prev.year, prev.month);
    const currentTotal = balance?.totalUah ?? 0;
    const rawHairPurchase = currentTotal < previous.balance ? previous.balance - currentTotal : 0;

    return NextResponse.json({
      ok: true,
      balance,
      suggestedHairPurchaseUah: roundPurchaseSuggestion(rawHairPurchase),
      previousMonthBalanceUah: previous.balance,
      storages,
      products: filteredProducts.slice(0, 500),
      stocks: filteredStocks.slice(0, 500).map((row) => ({
        id: row.id,
        quantity: row.quantity,
        costPerUnit: row.costPerUnit,
        valueUah: Math.round((row.quantity * (row.costPerUnit || row.product.costPerUnit || 0)) * 100) / 100,
        product: {
          id: row.product.id,
          title: row.product.title,
          category: row.product.category,
          unit: row.product.unit,
          isHair: row.product.isHair,
          lengthCm: row.product.lengthCm,
          costPerUnit: row.product.costPerUnit,
          salePrice: row.product.salePrice,
        },
        storage: {
          id: row.storage.id,
          title: row.storage.title,
          includeInFinanceReport: row.storage.includeInFinanceReport,
        },
      })),
      outOfStockHair: outOfStockHair.slice(0, 100).map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        lengthCm: p.lengthCm,
        costPerUnit: p.costPerUnit,
      })),
      documents: documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        source: doc.source,
        kyivDay: doc.kyivDay,
        occurredAt: doc.occurredAt,
        comment: doc.comment,
        createdBy: doc.createdBy,
        fromStorageTitle: doc.fromStorage?.title || null,
        toStorageTitle: doc.toStorage?.title || null,
        linesCount: doc.lines.length,
        totalQty: doc.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
        totalUah: Math.round(
          doc.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.costPerUnit) || 0), 0) * 100,
        ) / 100,
      })),
    });
  } catch (err) {
    console.error("[api/admin/warehouse] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка завантаження складу" },
      { status: 500 },
    );
  }
}
