// Читання дзеркала складу: живі залишки або знімок місяця.

import { prisma } from "@/lib/prisma";
import { getKyivYearMonth } from "./stock";

export type WarehouseStockSort = "sku" | "title" | "category" | "qty" | "value" | "storage";

export type WarehouseStockViewRow = {
  id: string;
  quantity: number;
  costPerUnit: number;
  valueUah: number;
  product: {
    id: string;
    sku: number | null;
    title: string;
    category: string | null;
    unit: string;
    isHair: boolean;
    lengthCm: number | null;
    costPerUnit: number;
  };
  storage: {
    id: string;
    title: string;
  };
};

function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sortRows(
  rows: WarehouseStockViewRow[],
  sort: WarehouseStockSort,
  order: "asc" | "desc",
): WarehouseStockViewRow[] {
  const dir = order === "asc" ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    let cmp = 0;
    if (sort === "sku") cmp = (a.product.sku || 0) - (b.product.sku || 0);
    else if (sort === "qty") cmp = a.quantity - b.quantity;
    else if (sort === "value") cmp = a.valueUah - b.valueUah;
    else if (sort === "category") cmp = (a.product.category || "").localeCompare(b.product.category || "", "uk");
    else if (sort === "storage") cmp = a.storage.title.localeCompare(b.storage.title, "uk");
    else cmp = a.product.title.localeCompare(b.product.title, "uk");
    return cmp * dir;
  });
  return copy;
}

function matchesFilters(
  row: WarehouseStockViewRow,
  params: {
    q: string;
    hair: "all" | "yes" | "no";
    storageId: string;
    category: string;
  },
): boolean {
  if (params.hair === "yes" && !row.product.isHair) return false;
  if (params.hair === "no" && row.product.isHair) return false;
  if (params.storageId && row.storage.id !== params.storageId) return false;
  if (params.category && (row.product.category || "") !== params.category) return false;
  if (params.q) {
    const hay = `${row.product.sku || ""} ${row.product.title} ${row.product.category || ""} ${row.storage.title}`.toLowerCase();
    if (!hay.includes(params.q)) return false;
  }
  return true;
}

export async function queryWarehouseStockView(params: {
  year: number;
  month: number;
  q: string;
  hair: "all" | "yes" | "no";
  storageId: string;
  category: string;
  includeZero: boolean;
  sort: WarehouseStockSort;
  order: "asc" | "desc";
}): Promise<{
  stocks: WarehouseStockViewRow[];
  isLive: boolean;
  snapshotMissing: boolean;
  snapshotCapturedAt: string | null;
  lastSyncedAt: string | null;
  categories: string[];
}> {
  const now = getKyivYearMonth();
  const isLive = params.year === now.year && params.month === now.month;

  const lastSync = await prisma.warehouseDocument.findFirst({
    where: { source: "altegio_import", type: "altegio_sync", status: "posted" },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  const lastSyncedAt = lastSync?.occurredAt.toISOString() || null;

  const categoriesRaw = await prisma.warehouseProduct.findMany({
    where: { isActive: true, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  const categories = categoriesRaw
    .map((row) => String(row.category || "").trim())
    .filter(Boolean);

  if (isLive) {
    const [stocks, products, storages] = await Promise.all([
      prisma.warehouseStock.findMany({
        include: { product: true, storage: true },
      }),
      params.includeZero
        ? prisma.warehouseProduct.findMany({ where: { isActive: true } })
        : Promise.resolve([]),
      params.includeZero ? prisma.warehouseStorage.findMany({ where: { isActive: true } }) : Promise.resolve([]),
    ]);

    const liveRows: WarehouseStockViewRow[] = stocks.map((row) => {
      const cost = Number(row.costPerUnit) || Number(row.product.costPerUnit) || 0;
      const quantity = Number(row.quantity) || 0;
      return {
        id: row.id,
        quantity,
        costPerUnit: cost,
        valueUah: roundMoney2(quantity * cost),
        product: {
          id: row.product.id,
          sku: row.product.sku,
          title: row.product.title,
          category: row.product.category,
          unit: row.product.unit,
          isHair: row.product.isHair,
          lengthCm: row.product.lengthCm,
          costPerUnit: row.product.costPerUnit,
        },
        storage: { id: row.storage.id, title: row.storage.title },
      };
    });

    if (params.includeZero) {
      const seen = new Set(liveRows.map((row) => `${row.product.id}::${row.storage.id}`));
      const defaultStorage = storages[0];
      for (const product of products) {
        const hasAny = liveRows.some((row) => row.product.id === product.id && row.quantity > 0);
        if (hasAny) continue;
        const storage = defaultStorage;
        if (!storage) continue;
        const key = `${product.id}::${storage.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        liveRows.push({
          id: `zero-${product.id}`,
          quantity: 0,
          costPerUnit: product.costPerUnit,
          valueUah: 0,
          product: {
            id: product.id,
            sku: product.sku,
            title: product.title,
            category: product.category,
            unit: product.unit,
            isHair: product.isHair,
            lengthCm: product.lengthCm,
            costPerUnit: product.costPerUnit,
          },
          storage: { id: storage.id, title: storage.title },
        });
      }
    }

    const filtered = sortRows(
      liveRows.filter((row) => (params.includeZero ? true : row.quantity > 0) && matchesFilters(row, params)),
      params.sort,
      params.order,
    );

    return {
      stocks: filtered,
      isLive: true,
      snapshotMissing: false,
      snapshotCapturedAt: lastSyncedAt,
      lastSyncedAt,
      categories,
    };
  }

  const snapshots = await prisma.warehouseStockMonthSnapshot.findMany({
    where: { year: params.year, month: params.month },
    include: { product: true, storage: true },
  });

  if (snapshots.length === 0) {
    return {
      stocks: [],
      isLive: false,
      snapshotMissing: true,
      snapshotCapturedAt: null,
      lastSyncedAt,
      categories,
    };
  }

  const rows: WarehouseStockViewRow[] = snapshots.map((row) => ({
    id: row.id,
    quantity: Number(row.quantity) || 0,
    costPerUnit: Number(row.costPerUnit) || 0,
    valueUah: Number(row.valueUah) || 0,
    product: {
      id: row.product.id,
      sku: row.product.sku,
      title: row.product.title,
      category: row.product.category,
      unit: row.product.unit,
      isHair: row.product.isHair,
      lengthCm: row.product.lengthCm,
      costPerUnit: row.product.costPerUnit,
    },
    storage: { id: row.storage.id, title: row.storage.title },
  }));

  const capturedAt = snapshots.reduce((max, row) => {
    const t = row.capturedAt.getTime();
    return t > max ? t : max;
  }, 0);

  return {
    stocks: sortRows(rows.filter((row) => matchesFilters(row, params)), params.sort, params.order),
    isLive: false,
    snapshotMissing: false,
    snapshotCapturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
    lastSyncedAt,
    categories,
  };
}
