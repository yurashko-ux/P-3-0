// Облік залишків нативного складу Kresco.
// База = знімок Altegio; документи source=kresco додаються зверху, доки каса ще в Altegio.

import { prisma } from "@/lib/prisma";
import type { WarehouseStorageBalanceRow } from "@/lib/altegio";

export type NativeWarehouseBalance = {
  totalUah: number;
  hairUah: number;
  perStorage: WarehouseStorageBalanceRow[];
  productCount: number;
  stockRowCount: number;
  hairProductCount: number;
};

type StockKey = string;

function stockKey(productId: string, storageId: string): StockKey {
  return `${productId}::${storageId}`;
}

function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

type MutableStock = {
  productId: string;
  storageId: string;
  quantity: number;
  costPerUnit: number;
};

function bumpStock(
  map: Map<StockKey, MutableStock>,
  productId: string,
  storageId: string,
  quantityDelta: number,
  costPerUnit: number,
) {
  if (!productId || !storageId || !Number.isFinite(quantityDelta) || quantityDelta === 0) return;
  const key = stockKey(productId, storageId);
  const current = map.get(key) || { productId, storageId, quantity: 0, costPerUnit: 0 };
  current.quantity = roundQty(current.quantity + quantityDelta);
  if (costPerUnit > 0) current.costPerUnit = costPerUnit;
  map.set(key, current);
}

function setStock(
  map: Map<StockKey, MutableStock>,
  productId: string,
  storageId: string,
  quantity: number,
  costPerUnit: number,
) {
  if (!productId || !storageId) return;
  const key = stockKey(productId, storageId);
  map.set(key, {
    productId,
    storageId,
    quantity: roundQty(quantity),
    costPerUnit: costPerUnit > 0 ? costPerUnit : map.get(key)?.costPerUnit || 0,
  });
}

export function applyWarehouseDocumentToStockMap(
  map: Map<StockKey, MutableStock>,
  doc: {
    type: string;
    fromStorageId: string | null;
    toStorageId: string | null;
    lines: Array<{ productId: string; quantity: number; costPerUnit: number }>;
  },
) {
  const type = String(doc.type || "");
  for (const line of doc.lines) {
    const qty = Number(line.quantity) || 0;
    const cost = Number(line.costPerUnit) || 0;
    if (!line.productId || qty === 0) continue;

    if (type === "intake" || type === "altegio_sync") {
      if (doc.toStorageId) bumpStock(map, line.productId, doc.toStorageId, qty, cost);
      continue;
    }
    if (type === "write_off" || type === "sale") {
      if (doc.fromStorageId) bumpStock(map, line.productId, doc.fromStorageId, -Math.abs(qty), cost);
      continue;
    }
    if (type === "transfer") {
      if (doc.fromStorageId) bumpStock(map, line.productId, doc.fromStorageId, -Math.abs(qty), cost);
      if (doc.toStorageId) bumpStock(map, line.productId, doc.toStorageId, Math.abs(qty), cost);
      continue;
    }
    if (type === "inventory_count") {
      const storageId = doc.toStorageId || doc.fromStorageId;
      if (storageId) setStock(map, line.productId, storageId, qty, cost);
    }
  }
}

/**
 * Перерахунок залишків: знімок Altegio (останній altegio_sync) + усі posted документи kresco.
 */
export async function rebuildWarehouseStocksFromDocuments(): Promise<{ stockRows: number }> {
  const [syncDocs, krescoDocs, products] = await Promise.all([
    prisma.warehouseDocument.findMany({
      where: { source: "altegio_import", type: "altegio_sync", status: "posted" },
      include: { lines: true },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.warehouseDocument.findMany({
      where: { source: "kresco", status: "posted" },
      include: { lines: true },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.warehouseProduct.findMany({ select: { id: true, costPerUnit: true } }),
  ]);

  const costByProduct = new Map(products.map((p) => [p.id, p.costPerUnit]));
  const map = new Map<StockKey, MutableStock>();

  for (const syncDoc of syncDocs) {
    applyWarehouseDocumentToStockMap(map, syncDoc);
  }

  for (const doc of krescoDocs) {
    applyWarehouseDocumentToStockMap(map, doc);
  }

  for (const row of map.values()) {
    if (!(row.costPerUnit > 0)) {
      row.costPerUnit = costByProduct.get(row.productId) || 0;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.warehouseStock.deleteMany();
    const rows = Array.from(map.values()).filter((row) => Math.abs(row.quantity) > 0.0000001);
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await tx.warehouseStock.createMany({
        data: chunk.map((row) => ({
          productId: row.productId,
          storageId: row.storageId,
          quantity: row.quantity,
          costPerUnit: row.costPerUnit,
        })),
      });
    }
  });

  const stockRows = await prisma.warehouseStock.count();
  console.log(`[warehouse/stock] Перераховано залишки: рядків=${stockRows}, krescoDocs=${krescoDocs.length}`);
  return { stockRows };
}

export async function applyPostedWarehouseDocument(documentId: string): Promise<void> {
  const doc = await prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    include: { lines: true },
  });
  if (!doc || doc.status !== "posted") return;

  const map = new Map<StockKey, MutableStock>();
  applyWarehouseDocumentToStockMap(map, doc);

  for (const row of map.values()) {
    const existing = await prisma.warehouseStock.findUnique({
      where: { productId_storageId: { productId: row.productId, storageId: row.storageId } },
    });
    const nextQty = roundQty((existing?.quantity || 0) + row.quantity);
    const nextCost =
      row.costPerUnit > 0 ? row.costPerUnit : existing?.costPerUnit || 0;
    await prisma.warehouseStock.upsert({
      where: { productId_storageId: { productId: row.productId, storageId: row.storageId } },
      create: {
        productId: row.productId,
        storageId: row.storageId,
        quantity: nextQty,
        costPerUnit: nextCost,
      },
      update: {
        quantity: nextQty,
        ...(nextCost > 0 ? { costPerUnit: nextCost } : {}),
      },
    });
  }
}

export async function getNativeWarehouseBalance(): Promise<NativeWarehouseBalance | null> {
  const [productCount, stockRows] = await Promise.all([
    prisma.warehouseProduct.count(),
    prisma.warehouseStock.findMany({
      include: {
        product: { select: { isHair: true, costPerUnit: true } },
        storage: { select: { altegioStorageId: true, title: true, includeInFinanceReport: true } },
      },
    }),
  ]);

  if (productCount === 0) return null;

  const perStorageMap = new Map<number, { title: string; balanceUah: number }>();
  let totalUah = 0;
  let hairUah = 0;
  let hairProductIds = new Set<string>();

  for (const row of stockRows) {
    const qty = Number(row.quantity) || 0;
    if (qty <= 0) continue;
    const unitCost = Number(row.costPerUnit) || Number(row.product.costPerUnit) || 0;
    const value = qty * unitCost;
    if (!(value > 0)) continue;

    if (row.storage.includeInFinanceReport) {
      totalUah += value;
      const storageId = row.storage.altegioStorageId ?? 0;
      const cur = perStorageMap.get(storageId) || { title: row.storage.title, balanceUah: 0 };
      cur.balanceUah += value;
      if (!cur.title) cur.title = row.storage.title;
      perStorageMap.set(storageId, cur);
    }
    if (row.product.isHair) {
      hairUah += value;
      hairProductIds.add(row.productId);
    }
  }

  if (!perStorageMap.size && stockRows.length > 0) {
    for (const row of stockRows) {
      const qty = Number(row.quantity) || 0;
      if (qty <= 0) continue;
      const unitCost = Number(row.costPerUnit) || Number(row.product.costPerUnit) || 0;
      const value = qty * unitCost;
      if (!(value > 0)) continue;
      totalUah += value;
      const storageId = row.storage.altegioStorageId ?? 0;
      const cur = perStorageMap.get(storageId) || { title: row.storage.title, balanceUah: 0 };
      cur.balanceUah += value;
      perStorageMap.set(storageId, cur);
    }
  }

  return {
    totalUah: roundMoney2(totalUah),
    hairUah: roundMoney2(hairUah),
    perStorage: Array.from(perStorageMap.entries()).map(([storageId, row]) => ({
      storageId,
      title: row.title,
      balanceUah: roundMoney2(row.balanceUah),
    })),
    productCount,
    stockRowCount: stockRows.length,
    hairProductCount: hairProductIds.size,
  };
}
