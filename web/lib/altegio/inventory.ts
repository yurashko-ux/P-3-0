// web/lib/altegio/inventory.ts
// Транзакції по товарах (inventory) + агрегована виручка по товарах за період

import { ALTEGIO_ENV } from "./env";
import { altegioFetch } from "./client";

// Тип транзакції складу з API
export type AltegioStorageTransaction = {
  id: number;
  type_id: number;
  amount: number;
  cost_per_unit: number;
  cost: number;
  create_date: string;
  good_id?: number;
  good?: {
    id: number;
    title: string;
  };
  [key: string]: any;
};


/** Інформація про проданий товар */
export type SoldGoodItem = {
  goodId?: number;
  title: string; // Назва товару
  quantity: number; // Кількість проданих одиниць
  costPerUnit: number; // Собівартість за одиницю
  totalCost: number; // Загальна собівартість (costPerUnit * quantity)
};

/** Агрегована інформація по продажах товарів за період */
export type GoodsSalesSummary = {
  range: { date_from: string; date_to: string };
  revenue: number; // Виручка з транзакцій (може бути нижча за реальну)
  cost: number; // Собівартість (ручно введене значення з KV або 0)
  profit: number; // Націнка (revenue - cost)
  costSource?: "goods_card" | "purchase_match" | "sale_document" | "actual_cost" | "manual" | "fallback" | "none"; // Джерело собівартості
  itemsCount: number; // Загальна кількість транзакцій продажу
  totalItemsSold: number; // Загальна кількість проданих одиниць товару
  costItemsCount?: number; // Загальна кількість одиниць товару, по яких розраховано собівартість з API
  costTransactionsCount?: number; // Кількість транзакцій, по яких успішно розраховано собівартість
  goodsList?: SoldGoodItem[]; // Список проданих товарів з деталями
  /**
   * Наближена «чиста зміна» складу в грн з GET /storages/transactions за період:
   * сума закупівель (type_id=2) мінус собівартість проданого (те саме поле cost звіту).
   * Не включає коригування/інші типи транзакцій; знак для поля rollforward перевіряйте за вашою методикою.
   */
  warehouseMovementEstimate?: {
    purchasesTotalUah: number;
    costOfGoodsSoldUah: number;
    impliedNetChangeUah: number;
    salesTransactionsCount: number;
    purchaseTransactionsCount: number;
  };
};

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;

  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error(
      "ALTEGIO_COMPANY_ID is required to fetch inventory transactions (optionally can fall back to ALTEGIO_PARTNER_ID / ALTEGIO_APPLICATION_ID)",
    );
  }
  return companyId;
}

function unwrapAltegioPayload<T = any>(raw: any): T | null {
  if (!raw || typeof raw !== "object") return null;
  if ("data" in raw && (raw as any).data != null) {
    const data = (raw as any).data;
    if (data && typeof data === "object" && "data" in data && (data as any).data != null) {
      return (data as any).data as T;
    }
    return data as T;
  }
  return raw as T;
}

function extractActualCostFromGoodsTransaction(raw: any): { actualCost: number | null; amount: number } {
  const payload = unwrapAltegioPayload<any>(raw);
  const good = payload && typeof payload === "object" ? payload.good : null;
  const amount = Math.abs(
    Number(payload?.amount) ||
      Number(payload?.quantity) ||
      Number(payload?.count) ||
      Number(payload?.qty) ||
      0,
  );

  const actualCost = Number(good?.actual_cost);
  if (Number.isFinite(actualCost) && actualCost >= 0) {
    return { actualCost: Math.abs(actualCost), amount };
  }

  const unitActualCost = Number(good?.unit_actual_cost);
  if (Number.isFinite(unitActualCost) && unitActualCost >= 0 && amount > 0) {
    return { actualCost: Math.abs(unitActualCost) * amount, amount };
  }

  return { actualCost: null, amount };
}

async function fetchActualCostForSalesTransactions(
  companyId: string,
  sales: any[],
): Promise<{ totalCost: number; successfulTransactions: number }> {
  if (sales.length === 0) {
    return { totalCost: 0, successfulTransactions: 0 };
  }

  const batchSize = 10;
  let totalCost = 0;
  let successfulTransactions = 0;

  console.log(
    `[altegio/inventory] 🔍 Отримуємо actual_cost для ${sales.length} продажів через goods_transactions`,
  );

  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (sale) => {
        const transactionId = Number(sale?.id) || 0;
        if (!transactionId) {
          return null;
        }

        try {
          const path = `/storage_operations/goods_transactions/${companyId}/${transactionId}`;
          const details = await altegioFetch<any>(path);
          const parsed = extractActualCostFromGoodsTransaction(details);
          if (parsed.actualCost != null) {
            return parsed.actualCost;
          }

          console.log(
            `[altegio/inventory] ⚠️ goods_transactions/${transactionId}: actual_cost відсутній`,
          );
          return null;
        } catch (err: any) {
          console.warn(
            `[altegio/inventory] ⚠️ Не вдалося отримати goods_transaction ${transactionId}:`,
            err?.message || String(err),
          );
          return null;
        }
      }),
    );

    for (const cost of results) {
      if (typeof cost === "number" && cost >= 0) {
        totalCost += cost;
        successfulTransactions += 1;
      }
    }

    if (i + batchSize < sales.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(
    `[altegio/inventory] ✅ actual_cost по продажах: ${totalCost} грн. (успішно: ${successfulTransactions}/${sales.length})`,
  );

  return { totalCost, successfulTransactions };
}

async function fetchAllStorageTransactions(params: {
  companyId: string;
  date_from: string;
  date_to: string;
}): Promise<any[]> {
  const { companyId, date_from, date_to } = params;
  const countPerPage = 1000;
  const allTransactions: any[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const qs = new URLSearchParams({
      start_date: date_from,
      end_date: date_to,
      page: String(page),
      count: String(countPerPage),
    });

    const path = `/storages/transactions/${companyId}?${qs.toString()}`;
    const raw = await altegioFetch<any>(path);
    const pageItems: any[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as any).data)
        ? (raw as any).data
        : [];

    allTransactions.push(...pageItems);

    console.log(
      `[altegio/inventory] 📄 storages/transactions page=${page}, count=${pageItems.length}`,
    );

    if (pageItems.length < countPerPage) {
      break;
    }
  }

  console.log(
    `[altegio/inventory] ✅ Усього отримано транзакцій складу за період: ${allTransactions.length}`,
  );

  return allTransactions;
}

function getSaleDocumentItems(raw: any): any[] {
  const payload = unwrapAltegioPayload<any>(raw);
  const state = payload && typeof payload === "object" ? payload.state : null;

  if (Array.isArray(state?.items)) return state.items;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractSaleDocumentGoods(raw: any, sale: any): {
  itemsCount: number;
  totalCost: number;
  goods: SoldGoodItem[];
} {
  const items = getSaleDocumentItems(raw);
  if (!Array.isArray(items) || items.length === 0) {
    const amount = Math.abs(Number(sale?.amount) || 0);
    const title = sale?.good?.title || sale?.good?.name || `Товар #${sale?.good_id || sale?.id || "N/A"}`;
    const fallbackCostPerUnit = Number(sale?.cost_per_unit) || 0;
    return {
      itemsCount: amount,
      totalCost: amount > 0 && fallbackCostPerUnit > 0 ? amount * fallbackCostPerUnit : 0,
      goods: amount > 0
        ? [{
            goodId: sale?.good_id,
            title,
            quantity: amount,
            costPerUnit: fallbackCostPerUnit,
            totalCost: amount * fallbackCostPerUnit,
          }]
        : [],
    };
  }

  const goods: SoldGoodItem[] = [];
  let itemsCount = 0;
  let totalCost = 0;

  for (const item of items) {
    const type = String(item?.type || "").toLowerCase();
    if (type && type !== "good") continue;

    const quantity = Math.abs(
      Number(item?.amount) ||
      Number(item?.quantity) ||
      Number(item?.count) ||
      Number(item?.qty) ||
      1,
    );
    if (quantity <= 0) continue;

    const costPerUnit = Number(item?.default_cost_per_unit) || 0;
    const totalCostForItem = Number(item?.default_cost_total) || (costPerUnit > 0 ? costPerUnit * quantity : 0);
    const goodId = item?.good_id || item?.good?.id || item?.id;
    const title =
      item?.title ||
      item?.good?.title ||
      item?.good?.name ||
      `Товар #${goodId || sale?.id || "N/A"}`;

    itemsCount += quantity;
    totalCost += Math.abs(totalCostForItem);
    goods.push({
      goodId,
      title,
      quantity,
      costPerUnit,
      totalCost: Math.abs(totalCostForItem),
    });
  }

  return { itemsCount, totalCost, goods };
}

function mergeGoodsIntoMap(goodsMap: Map<number | string, SoldGoodItem>, goods: SoldGoodItem[]) {
  for (const good of goods) {
    const key = good.goodId || good.title;
    const existing = goodsMap.get(key);
    if (existing) {
      existing.quantity += good.quantity;
      existing.totalCost += good.totalCost;
      existing.costPerUnit = existing.quantity > 0 ? existing.totalCost / existing.quantity : 0;
      continue;
    }

    goodsMap.set(key, {
      ...good,
      costPerUnit: good.quantity > 0 ? good.totalCost / good.quantity : good.costPerUnit,
    });
  }
}

/**
 * ID документа продажу для GET /company/{id}/sale/{document_id}.
 * Не використовувати sale.id — це id складської транзакції, інакше документ не відкриється і Σ default_cost_total = 0.
 */
function getStorageSaleDocumentIdForFetch(sale: any): number {
  const raw = unwrapAltegioPayload<any>(sale) || sale;
  const candidates = [
    raw?.document_id,
    raw?.document?.id,
    raw?.sale_document_id,
    (raw as any)?.data?.document_id,
    sale?.document_id,
    sale?.document?.id,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 0;
}

const MAX_GOODS_TX_DOC_ID_LOOKUPS = 280;

/** Якщо у списку продажів немає document_id — дістаємо його з деталі goods_transactions (там поле document_id). */
async function enrichSalesWithDocumentIdsFromGoodsTransactions(
  companyId: string,
  sales: any[],
): Promise<void> {
  const txIds = new Set<number>();
  for (const s of sales) {
    if (getStorageSaleDocumentIdForFetch(s) > 0) continue;
    const tid = Number(s?.id);
    if (Number.isFinite(tid) && tid > 0) {
      txIds.add(tid);
    }
  }
  if (txIds.size === 0) {
    return;
  }

  const ids = [...txIds];
  const capped = ids.length > MAX_GOODS_TX_DOC_ID_LOOKUPS ? ids.slice(0, MAX_GOODS_TX_DOC_ID_LOOKUPS) : ids;
  if (ids.length > MAX_GOODS_TX_DOC_ID_LOOKUPS) {
    console.warn(
      `[altegio/inventory] document_id відсутній у ${ids.length} транзакціях; lookup goods_transactions обмежено ${MAX_GOODS_TX_DOC_ID_LOOKUPS}`,
    );
  }

  const tidToDoc = new Map<number, number>();
  const batchSize = 12;
  for (let i = 0; i < capped.length; i += batchSize) {
    const slice = capped.slice(i, i + batchSize);
    const results = await Promise.all(
      slice.map(async (tid) => {
        try {
          const raw = await altegioFetch<any>(
            `/storage_operations/goods_transactions/${companyId}/${tid}`,
          );
          const u = unwrapAltegioPayload<any>(raw) || raw;
          const docId = Number(u?.document_id || (u as any)?.data?.document_id || 0);
          return { tid, docId: Number.isFinite(docId) && docId > 0 ? docId : 0 };
        } catch {
          return { tid, docId: 0 };
        }
      }),
    );
    for (const { tid, docId } of results) {
      if (docId > 0) {
        tidToDoc.set(tid, docId);
      }
    }
    if (i + batchSize < capped.length) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  let attached = 0;
  for (const s of sales) {
    if (getStorageSaleDocumentIdForFetch(s) > 0) {
      continue;
    }
    const tid = Number(s?.id);
    const docId = tidToDoc.get(tid);
    if (docId && docId > 0) {
      (s as any).document_id = docId;
      attached += 1;
    }
  }
  if (attached > 0) {
    console.log(
      `[altegio/inventory] Підставлено document_id з goods_transactions для ${attached} рядків продажу (для завантаження /sale/{document_id})`,
    );
  }
}

function unwrapGoodsList(raw: any): any[] {
  return Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : raw && typeof raw === "object" && Array.isArray((raw as any).goods)
        ? (raw as any).goods
        : raw && typeof raw === "object" && Array.isArray((raw as any).items)
          ? (raw as any).items
          : [];
}

function getGoodCardCostPerUnit(good: any): number {
  const actualCost = Number(good?.actual_cost) || 0;
  if (actualCost > 0) {
    return actualCost;
  }

  const unitActualCost = Number(good?.unit_actual_cost) || 0;
  const unitEquals = Number(good?.unit_equals) || 0;
  if (unitActualCost > 0 && unitEquals > 0) {
    return unitActualCost * unitEquals;
  }

  return Number(good?.default_cost_per_unit) ||
    Number(good?.cost_per_unit) ||
    Number(good?.cost) ||
    Number(good?.purchase_price) ||
    Number(good?.wholesale_price) ||
    0;
}

/**
 * Одиниця для оцінки залишку на складі (грн за одиницю товару).
 * Спочатку ті самі поля, що й для картки товару (actual_cost, unit_actual_cost тощо),
 * потім типові продажні поля — екран складу в Altegio часто показує залишок у «цінниках», не лише в собівартості.
 */
function getWarehouseStockValuationUnitPrice(good: any): number {
  const fromCostChain = getGoodCardCostPerUnit(good);
  if (fromCostChain > 0) {
    return fromCostChain;
  }

  return (
    Number(good.sale_price) ||
    Number(good.selling_price) ||
    Number(good.retail_price) ||
    Number(good.price_sale) ||
    Number(good.actual_sale_price) ||
    Number(good.price) ||
    Number(good.default_price) ||
    Number(good.cost_sale) ||
    0
  );
}

const GOODS_LIST_PAGE_SIZE = 500;
const GOODS_LIST_MAX_PAGES = 400;

function mergeWarehouseGoodsDedupe(items: any[]): any[] {
  const map = new Map<string, any>();
  let anonIdx = 0;
  for (const g of items) {
    const id = Number(g?.good_id ?? g?.id ?? 0);
    const key = id > 0 ? `id:${id}` : `anon:${anonIdx++}`;
    map.set(key, g);
  }
  return [...map.values()];
}

/**
 * Деякі інстанси Altegio/YCLIENTS ігнорують page/count і повторюють першу порцію;
 * тоді offset/limit інколи все одно зсуває вікно вибірки.
 */
async function tryFetchGoodsOffsetLimit(basePath: string, label: string): Promise<any[]> {
  const limit = GOODS_LIST_PAGE_SIZE;
  const all: any[] = [];
  for (let offset = 0; offset <= limit * GOODS_LIST_MAX_PAGES; offset += limit) {
    try {
      const qs = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      const raw = await altegioFetch<any>(`${basePath}?${qs.toString()}`);
      const batch = unwrapGoodsList(raw);
      if (batch.length === 0) {
        break;
      }
      all.push(...batch);
      if (batch.length < limit) {
        break;
      }
    } catch (err: any) {
      console.warn(
        `[altegio/inventory] ${label} offset/limit зупинено на offset=${offset}:`,
        err?.message || String(err),
      );
      break;
    }
  }
  const out = mergeWarehouseGoodsDedupe(all);
  console.log(`[altegio/inventory] ${label}: offset/limit → ${out.length} унікальних товарів (сирих ${all.length})`);
  return out;
}

/**
 * Altegio часто віддає список товарів сторінками (?page=&count=); без циклу береться лише перша порція —
 * сума в CRM тоді радикально нижча за «Залишки» в інтерфейсі Altegio.
 */
async function tryFetchPagedOrSingleGoods(basePath: string, label: string): Promise<any[]> {
  try {
    const qsFirst = new URLSearchParams({
      page: "1",
      count: String(GOODS_LIST_PAGE_SIZE),
    });
    const rawFirst = await altegioFetch<any>(`${basePath}?${qsFirst.toString()}`);
    const batchFirst = unwrapGoodsList(rawFirst);

    // Якщо з query все порожньо — пробуємо без параметрів (старий режим API).
    if (batchFirst.length === 0) {
      const rawSingle = await altegioFetch<any>(basePath);
      const single = unwrapGoodsList(rawSingle);
      console.log(`[altegio/inventory] ${label}: ${single.length} товарів (один запит без pagination)`);
      return mergeWarehouseGoodsDedupe(single);
    }

    const all: any[] = [...batchFirst];
    let prevUniqueCount = mergeWarehouseGoodsDedupe(all).length;
    let stoppedForDuplicate = false;

    for (let page = 2; page <= GOODS_LIST_MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        page: String(page),
        count: String(GOODS_LIST_PAGE_SIZE),
      });
      const raw = await altegioFetch<any>(`${basePath}?${qs.toString()}`);
      const batch = unwrapGoodsList(raw);
      if (batch.length === 0) {
        break;
      }
      all.push(...batch);
      const newUniqueCount = mergeWarehouseGoodsDedupe(all).length;
      if (newUniqueCount === prevUniqueCount) {
        stoppedForDuplicate = true;
        console.warn(
          `[altegio/inventory] ${label}: page=${page} не додав нових good_id після dedupe — ймовірно API ігнорує page/count, відкочуємо порцію`,
        );
        all.splice(all.length - batch.length, batch.length);
        break;
      }
      prevUniqueCount = newUniqueCount;
      if (batch.length < GOODS_LIST_PAGE_SIZE) {
        break;
      }
    }

    const firstDeduped = mergeWarehouseGoodsDedupe(batchFirst);
    let finalDeduped = mergeWarehouseGoodsDedupe(all);
    const uniqueStuckAtFirstPage =
      finalDeduped.length === firstDeduped.length &&
      firstDeduped.length > 0 &&
      (batchFirst.length >= GOODS_LIST_PAGE_SIZE || stoppedForDuplicate);

    if (uniqueStuckAtFirstPage) {
      const viaOffset = await tryFetchGoodsOffsetLimit(basePath, `${label} (fallback offset)`);
      if (viaOffset.length > finalDeduped.length) {
        console.warn(
          `[altegio/inventory] ${label}: page/count дав лише ${finalDeduped.length} унікальних, offset/limit — ${viaOffset.length}; беремо offset`,
        );
        finalDeduped = viaOffset;
      }
    }

    console.log(
      `[altegio/inventory] ${label}: ${finalDeduped.length} унікальних товарів (pagination, сирих рядків ${all.length})`,
    );
    return finalDeduped;
  } catch (err: any) {
    console.warn(`[altegio/inventory] ${label} pagination недоступна або помилка:`, err?.message || String(err));
    try {
      const raw = await altegioFetch<any>(basePath);
      const goods = unwrapGoodsList(raw);
      console.log(`[altegio/inventory] ${label}: fallback один запит — ${goods.length} товарів`);
      return mergeWarehouseGoodsDedupe(goods);
    } catch (err2: any) {
      console.warn(`[altegio/inventory] ${label} повний провал:`, err2?.message || String(err2));
      return [];
    }
  }
}

function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Рядок залишку по одному складу (блок №4 фінансового звіту).
 * storageId = 0 — агреговано без прив’язки до складу в API або fallback за транзакціями.
 */
export type WarehouseStorageBalanceRow = {
  storageId: number;
  title: string;
  balanceUah: number;
};

async function fetchGoodsListForWarehouseBalance(companyId: string): Promise<any[]> {
  const primaryPath = `/goods/${companyId}`;
  let goods = await tryFetchPagedOrSingleGoods(primaryPath, `GET ${primaryPath}`);

  if (goods.length === 0) {
    const fallbackPaths = [`/storages/${companyId}/goods`, `/company/${companyId}/goods`];
    for (const fallbackPath of fallbackPaths) {
      console.log(`[altegio/inventory] Спроба fallback: ${fallbackPath}`);
      goods = await tryFetchPagedOrSingleGoods(fallbackPath, `GET ${fallbackPath}`);
      if (goods.length > 0) {
        break;
      }
    }
  }

  if (goods.length > 0) {
    const sampleGood = goods[0];
    console.log(`[altegio/inventory] Зразок товару для складу:`, {
      id: sampleGood.id ?? sampleGood.good_id,
      title: sampleGood.title || sampleGood.name,
      hasActualAmounts: Array.isArray(sampleGood.actual_amounts),
      actualAmountsLength: Array.isArray(sampleGood.actual_amounts) ? sampleGood.actual_amounts.length : 0,
      valuationUnit: getWarehouseStockValuationUnitPrice(sampleGood),
      keysSample: Object.keys(sampleGood).slice(0, 24),
    });
    if (Array.isArray(sampleGood.actual_amounts) && sampleGood.actual_amounts.length > 0) {
      console.log(
        `[altegio/inventory] Sample actual_amounts[0]:`,
        JSON.stringify(sampleGood.actual_amounts[0], null, 2),
      );
    }
  }

  return goods;
}

async function getWarehouseBalanceFromTransactions(companyId: string, date: string): Promise<number> {
  const qs = new URLSearchParams({
    start_date: "2000-01-01",
    end_date: date,
  });
  const txPath = `/storages/transactions/${companyId}?${qs.toString()}`;
  const raw = await altegioFetch<any>(txPath);
  const tx: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : [];

  const balance = tx.reduce((sum, t) => {
    const typeId = Number(t.type_id);
    const amount = Math.abs(Number(t.amount) || 0);
    const costPerUnit = Number(t.cost_per_unit) || 0;
    if (amount > 0 && costPerUnit > 0) {
      const value = amount * costPerUnit;
      return sum + (typeId === 1 ? -value : value);
    }
    return sum;
  }, 0);

  console.log(
    `[altegio/inventory] Warehouse balance on ${date} (calculated from transactions): ${balance} (from ${tx.length} transactions)`,
  );
  return balance;
}

function parseActualAmountEntry(amount: any): { storageId: number; qty: number; title?: string } {
  const qty =
    typeof amount === "object" && amount !== null
      ? Math.abs(
          Number(amount.amount) ||
            Number(amount.quantity) ||
            Number(amount.count) ||
            Number(amount.qty) ||
            0,
        )
      : Math.abs(Number(amount) || 0);

  if (typeof amount !== "object" || amount === null) {
    return { storageId: 0, qty };
  }

  const storageId = Number(
    amount.storage_id ??
      amount.storageId ??
      amount.storages_id ??
      amount.storage?.id ??
      amount.storage?.storage_id ??
      0,
  );

  const titleRaw =
    amount.storage_title ??
    amount.storage_name ??
    amount.storage?.title ??
    amount.storage?.name ??
    amount.title;
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";

  return { storageId: Number.isFinite(storageId) ? storageId : 0, qty, title: title || undefined };
}

function computeTotalWarehouseBalanceFromGoods(goods: any[]): number {
  let totalBalance = 0;
  for (const good of goods) {
    const costPerUnit = getWarehouseStockValuationUnitPrice(good);
    if (costPerUnit <= 0) continue;

    let totalQuantity = 0;
    if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
      totalQuantity = good.actual_amounts.reduce((sum: number, amount: any) => {
        const parsed = parseActualAmountEntry(amount);
        return sum + parsed.qty;
      }, 0);
    }
    if (totalQuantity === 0) {
      totalQuantity = Math.abs(
        Number(good.amount) ||
          Number(good.quantity) ||
          Number(good.count) ||
          Number(good.qty) ||
          Number(good.balance) ||
          Number(good.stock) ||
          Number(good.total_amount) ||
          0,
      );
    }
    if (totalQuantity > 0 && costPerUnit > 0) {
      totalBalance += totalQuantity * costPerUnit;
    }
  }
  return totalBalance;
}

function computePerStorageBalancesFromGoods(goods: any[]): Map<number, { balance: number; title?: string }> {
  const byId = new Map<number, { balance: number; title?: string }>();
  const add = (id: number, delta: number, title?: string) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    const cur = byId.get(id) || { balance: 0, title: undefined };
    cur.balance += delta;
    if (title && !cur.title) cur.title = title;
    byId.set(id, cur);
  };

  for (const good of goods) {
    const costPerUnit = getWarehouseStockValuationUnitPrice(good);
    if (costPerUnit <= 0) continue;

    if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
      const entries = good.actual_amounts.map(parseActualAmountEntry).filter((e) => e.qty > 0);
      if (entries.length === 0) continue;

      const hasPositiveStorage = entries.some((e) => e.storageId > 0);
      if (hasPositiveStorage) {
        for (const e of entries) {
          const sid = e.storageId > 0 ? e.storageId : 0;
          add(sid, e.qty * costPerUnit, e.title);
        }
      } else {
        const sumQty = entries.reduce((s, e) => s + e.qty, 0);
        add(0, sumQty * costPerUnit, undefined);
      }
      continue;
    }

    const totalQuantity = Math.abs(
      Number(good.amount) ||
        Number(good.quantity) ||
        Number(good.count) ||
        Number(good.qty) ||
        Number(good.balance) ||
        Number(good.stock) ||
        Number(good.total_amount) ||
        0,
    );
    if (totalQuantity > 0) {
      add(0, totalQuantity * costPerUnit, undefined);
    }
  }

  return byId;
}

function mapToWarehouseStorageRows(byId: Map<number, { balance: number; title?: string }>): WarehouseStorageBalanceRow[] {
  const rows: WarehouseStorageBalanceRow[] = [];
  for (const [storageId, { balance, title }] of byId.entries()) {
    if (Math.abs(balance) < 1e-9) continue;
    const label =
      storageId === 0
        ? title?.trim() || "Без розбивки по складах"
        : title?.trim() || `Склад #${storageId}`;
    rows.push({
      storageId,
      title: label,
      balanceUah: roundMoney2(balance),
    });
  }
  rows.sort((a, b) => {
    if (a.storageId === 0) return 1;
    if (b.storageId === 0) return -1;
    return a.storageId - b.storageId;
  });
  return rows;
}

function unwrapSingleGood(raw: any): any | null {
  const payload = unwrapAltegioPayload<any>(raw);
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }
  return payload && typeof payload === "object" ? payload : null;
}

async function fetchGoodsCardsByIds(
  companyId: string,
  productIds: number[],
): Promise<Map<number, any>> {
  const goodsById = new Map<number, any>();
  const uniqueIds = Array.from(new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)));
  const batchSize = 10;

  console.log(
    `[altegio/inventory] 🔍 Отримуємо детальні картки товарів через /goods/${companyId}/{product_id}: ${uniqueIds.length} шт.`,
  );

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (productId) => {
        try {
          const path = `/goods/${companyId}/${productId}`;
          const raw = await altegioFetch<any>(path);
          const good = unwrapSingleGood(raw);
          if (!good) {
            return null;
          }

          const goodId = Number(good?.good_id || good?.id || productId);
          return goodId > 0 ? { goodId, good } : null;
        } catch (err: any) {
          console.log(
            `[altegio/inventory] ⚠️ Не вдалося отримати картку товару ${productId}:`,
            err?.message || String(err),
          );
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result) {
        goodsById.set(result.goodId, result.good);
      }
    }

    if (i + batchSize < uniqueIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(
    `[altegio/inventory] ✅ Отримано детальних карток товарів: ${goodsById.size}/${uniqueIds.length}`,
  );

  return goodsById;
}

function calculateCostFromGoodsCards(
  sales: any[],
  goodsById: Map<number, any>,
): {
  totalCost: number;
  matchedGoods: number;
  matchedItems: number;
  goodsList: SoldGoodItem[];
  unmatchedGoods: Array<{ goodId?: number; title: string; quantity: number }>;
} {
  const goodsMap = new Map<number | string, SoldGoodItem>();
  const unmatchedGoods: Array<{ goodId?: number; title: string; quantity: number }> = [];
  let totalCost = 0;
  let matchedGoods = 0;
  let matchedItems = 0;

  for (const sale of sales) {
    const goodId = Number(sale?.good_id || sale?.good?.id || 0);
    const quantity = Math.abs(Number(sale?.amount) || 0);
    const title =
      sale?.good?.title ||
      sale?.good?.name ||
      `Товар #${goodId || sale?.id || "N/A"}`;
    if (quantity <= 0) continue;

    const key = goodId || title;
    const existing = goodsMap.get(key);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    goodsMap.set(key, {
      goodId: goodId || undefined,
      title,
      quantity,
      costPerUnit: 0,
      totalCost: 0,
    });
  }

  const goodsList = Array.from(goodsMap.values());

  for (const item of goodsList) {
    const goodCard = item.goodId ? goodsById.get(item.goodId) : null;
    const costPerUnit = getGoodCardCostPerUnit(goodCard);
    if (costPerUnit > 0) {
      item.costPerUnit = costPerUnit;
      item.totalCost = costPerUnit * item.quantity;
      totalCost += item.totalCost;
      matchedGoods += 1;
      matchedItems += item.quantity;
    } else {
      unmatchedGoods.push({
        goodId: item.goodId,
        title: item.title,
        quantity: item.quantity,
      });
    }
  }

  return {
    totalCost,
    matchedGoods,
    matchedItems,
    goodsList,
    unmatchedGoods,
  };
}

/**
 * Загальний баланс складу + залишки по складах (останній знімок з API товарів на дату для транзакційного fallback).
 * Згідно з документацією: https://developer.alteg.io/api#tag/Inventory
 */
export async function getWarehouseBalanceDetailed(params: {
  date: string;
}): Promise<{ total: number; storages: WarehouseStorageBalanceRow[] }> {
  const { date } = params;
  const companyId = resolveCompanyId();

  try {
    console.log(
      `[altegio/inventory] Fetching warehouse balance (detailed) for date ${date} using GET /goods/${companyId}`,
    );

    const goods = await fetchGoodsListForWarehouseBalance(companyId);

    if (goods.length === 0) {
      console.log(`[altegio/inventory] ⚠️ No goods found from direct API, calculating balance from transactions...`);
      const balance = await getWarehouseBalanceFromTransactions(companyId, date);
      const total = balance;
      const storages: WarehouseStorageBalanceRow[] = [
        {
          storageId: 0,
          title: "Залишок за транзакціями (без розбивки по складах)",
          balanceUah: roundMoney2(total),
        },
      ];
      return { total, storages };
    }

    const total = computeTotalWarehouseBalanceFromGoods(goods);
    const byStorage = computePerStorageBalancesFromGoods(goods);
    const storages = mapToWarehouseStorageRows(byStorage);

    let goodsWithStock = 0;
    let goodsWithoutStock = 0;
    for (const good of goods) {
      const cpu = getWarehouseStockValuationUnitPrice(good);
      if (cpu <= 0) {
        goodsWithoutStock++;
        continue;
      }
      let totalQuantity = 0;
      if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
        totalQuantity = good.actual_amounts.reduce((sum: number, amount: any) => {
          return sum + parseActualAmountEntry(amount).qty;
        }, 0);
      }
      if (totalQuantity === 0) {
        totalQuantity = Math.abs(
          Number(good.amount) ||
            Number(good.quantity) ||
            Number(good.count) ||
            Number(good.qty) ||
            Number(good.balance) ||
            Number(good.stock) ||
            Number(good.total_amount) ||
            0,
        );
      }
      if (totalQuantity > 0 && cpu > 0) goodsWithStock++;
      else goodsWithoutStock++;
    }

    console.log(`[altegio/inventory] ✅ Warehouse balance on ${date}: ${total} UAH`);
    console.log(`[altegio/inventory]   - Goods with stock: ${goodsWithStock}`);
    console.log(`[altegio/inventory]   - Goods without stock/cost: ${goodsWithoutStock}`);
    console.log(`[altegio/inventory]   - Storages in breakdown: ${storages.length}`);

    return { total, storages };
  } catch (error: any) {
    console.error(`[altegio/inventory] ❌ Failed to get warehouse balance:`, error?.message || String(error));
    return { total: 0, storages: [] };
  }
}

/**
 * Отримати баланс складу на конкретну дату (сума в грн).
 */
export async function getWarehouseBalance(params: { date: string }): Promise<number> {
  const { total } = await getWarehouseBalanceDetailed(params);
  return total;
}


/**
 * Отримати агреговану виручку / собівартість / націнку по товарах із inventory transactions за період.
 *
 * Використовуємо `/storages/transactions/{locationId}` для отримання транзакцій продажу.
 * Собівартість беремо з `GET /storage_operations/goods_transactions/{location_id}/{transaction_id}`
 * через поле `data.good.actual_cost`. Якщо API не повернув значення, використовуємо ручний fallback.
 *
 * Припущення:
 * - `cost` у транзакції продажу = виручка по товару (Total cost у звіті)
 * - Пріоритет: `actual_cost` з goods_transactions
 * - Fallback: ручно збережена собівартість з KV
 * - `amount` = кількість проданих одиниць (може бути від'ємним для повернень)
 *
 * Тоді:
 *   revenue = Σ |cost| (для type_id = 1)
 *   cost    = Σ actual_cost по транзакціях продажу (fallback: manual / legacy)
 *   profit  = revenue - cost
 */
export async function fetchGoodsSalesSummary(params: {
  date_from: string;
  date_to: string;
}): Promise<GoodsSalesSummary> {
  const { date_from, date_to } = params;
  const companyId = resolveCompanyId();

  // Перевіряємо, чи є збережене значення собівартості для цього періоду
  // Використовуємо динамічний імпорт, щоб уникнути проблем з server components
  let manualCost: number | null = null;
  try {
    const dateFrom = new Date(date_from);
    const year = dateFrom.getFullYear();
    const month = dateFrom.getMonth() + 1;

    const costKey = `finance:goods:cost:${year}:${month}`;
    console.log(`[altegio/inventory] Checking for manual cost: key=${costKey}, year=${year}, month=${month}`);
    
    // Динамічний імпорт для уникнення проблем з server components
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const rawValue = await kvReadModule.getRaw(costKey);
      console.log(`[altegio/inventory] KV read result for ${costKey}:`, {
        hasValue: rawValue !== null,
        valueType: typeof rawValue,
        valuePreview: rawValue ? String(rawValue).slice(0, 100) : null,
      });
      
      if (rawValue !== null && typeof rawValue === "string") {
        // kvGetRaw може повертати {"value":"..."} або просто "..."
        // Потрібно витягти значення з об'єкта, якщо воно там є
        let costValue: number | null = null;
        try {
          // Спробуємо розпарсити як JSON
          const parsed = JSON.parse(rawValue);
          console.log(`[altegio/inventory] Parsed JSON:`, { parsed, type: typeof parsed });
          
          if (typeof parsed === "number") {
            costValue = parsed;
          } else if (typeof parsed === "object" && parsed !== null) {
            // Якщо це об'єкт, шукаємо value всередині
            const value = (parsed as any).value ?? parsed;
            if (typeof value === "number") {
              costValue = value;
            } else if (typeof value === "string") {
              costValue = parseFloat(value);
            } else {
              costValue = parseFloat(String(value));
            }
          } else if (typeof parsed === "string") {
            costValue = parseFloat(parsed);
          } else {
            costValue = parseFloat(String(parsed));
          }
        } catch {
          // Якщо не JSON, пробуємо як число
          console.log(`[altegio/inventory] Not JSON, trying parseFloat:`, rawValue);
          costValue = parseFloat(rawValue);
        }
        
        console.log(`[altegio/inventory] Parsed cost value:`, {
          costValue,
          isFinite: Number.isFinite(costValue),
          isNonNegative: costValue !== null && costValue >= 0,
        });
        
        if (costValue !== null && Number.isFinite(costValue) && costValue >= 0) {
          manualCost = costValue;
          console.log(
            `[altegio/inventory] ✅ Using manual cost for ${year}-${month}: ${manualCost}`,
          );
        } else {
          console.log(
            `[altegio/inventory] ⚠️ Invalid cost value: ${costValue} (not finite or negative)`,
          );
        }
      } else {
        console.log(
          `[altegio/inventory] ⚠️ No raw value found or wrong type for ${costKey}`,
        );
      }
    } else {
      console.warn(`[altegio/inventory] ⚠️ kvReadModule.getRaw is not a function`);
    }
  } catch (err: any) {
    // Логуємо помилки для діагностики
    console.error(
      `[altegio/inventory] ❌ Failed to check manual cost:`,
      err?.message || String(err),
      err?.stack,
    );
  }

  const tx = await fetchAllStorageTransactions({
    companyId,
    date_from,
    date_to,
  });

  console.log(
    `[altegio/inventory] Fetched ${tx.length} transactions`,
  );

  // Детальне логування структури транзакцій для діагностики собівартості
  if (tx.length > 0) {
    const sampleTx = tx[0];
    console.log(`[altegio/inventory] Sample transaction structure:`, {
      id: sampleTx.id,
      type_id: sampleTx.type_id,
      amount: sampleTx.amount,
      cost: sampleTx.cost,
      cost_per_unit: sampleTx.cost_per_unit,
      allKeys: Object.keys(sampleTx),
      // Шукаємо поля, що можуть містити собівартість
      possibleCostFields: Object.keys(sampleTx).filter(key => 
        key.toLowerCase().includes('cost') || 
        key.toLowerCase().includes('price') ||
        key.toLowerCase().includes('purchase') ||
        key.toLowerCase().includes('wholesale') ||
        key.toLowerCase().includes('buy')
      ),
    });
    
    // Логуємо всі поля першої транзакції для повного розуміння структури
    console.log(`[altegio/inventory] Full sample transaction:`, JSON.stringify(sampleTx, null, 2).substring(0, 2000));
  }

  // type_id = 1 — продаж товарів (Sale of goods)
  // type_id = 2 — закупівля товарів (Purchase of goods) - можливо тут є собівартість
  // Беремо всі транзакції типу 1 (продажі), включаючи повернення
  const sales = tx.filter((t) => Number(t.type_id) === 1);
  
  // Також перевіряємо транзакції закупки (type_id = 2), можливо там є інформація про собівартість
  const purchases = tx.filter((t) => Number(t.type_id) === 2);

  console.log(
    `[altegio/inventory] filtered sales (type_id=1): ${sales.length} items, purchases (type_id=2): ${purchases.length} items`,
  );

  await enrichSalesWithDocumentIdsFromGoodsTransactions(companyId, sales);
  
  // Логуємо структуру транзакції закупки, якщо вона є
  if (purchases.length > 0) {
    const samplePurchase = purchases[0];
    console.log(`[altegio/inventory] Sample purchase transaction (type_id=2):`, {
      id: samplePurchase.id,
      type_id: samplePurchase.type_id,
      amount: samplePurchase.amount,
      cost: samplePurchase.cost,
      cost_per_unit: samplePurchase.cost_per_unit,
      allKeys: Object.keys(samplePurchase),
    });
  }

  // Розраховуємо виручку: використовуємо cost (загальна сума транзакції), якщо він є
  // Якщо cost = 0, тоді використовуємо cost_per_unit * amount
  // Для продажів amount зазвичай від'ємний (зменшення складу), тому беремо абсолютне значення
  const revenue = sales.reduce(
    (sum, t) => {
      const transactionCost = Math.abs(Number(t.cost) || 0);
      if (transactionCost > 0) {
        // Використовуємо cost (загальна сума), якщо він є
        return sum + transactionCost;
      } else {
        // Fallback: cost_per_unit * amount
        const amount = Math.abs(Number(t.amount) || 0);
        const costPerUnit = Number(t.cost_per_unit) || 0;
        return sum + amount * costPerUnit;
      }
    },
    0,
  );

  // Спочатку рахуємо загальну кількість проданих одиниць товару з транзакцій складу
  // (це буде fallback, якщо не вдасться отримати дані з документів продажу)
  const totalItemsSoldFromTransactions = sales.reduce(
    (sum, t) => {
      const amount = Math.abs(Number(t.amount) || 0);
      return sum + amount;
    },
    0,
  );
  
  // Детальне логування для діагностики
  console.log(`[altegio/inventory] 📊 Sales transactions analysis:`);
  console.log(`  - Total sales transactions: ${sales.length}`);
  console.log(`  - Total items sold (sum of amounts from transactions): ${totalItemsSoldFromTransactions}`);
  
  // Логуємо деталі перших кількох транзакцій
  if (sales.length > 0) {
    const sampleSales = sales.slice(0, 5).map(t => ({
      id: t.id,
      amount: t.amount,
      amount_abs: Math.abs(Number(t.amount) || 0),
      good_id: t.good_id,
      good_title: t.good?.title || 'N/A',
    }));
    console.log(`[altegio/inventory] Sample sales transactions:`, JSON.stringify(sampleSales, null, 2));
  }
  
  // Загальна кількість проданих одиниць товару
  // Буде оновлено при отриманні документів продажу
  let totalItemsSold = totalItemsSoldFromTransactions;

  // Спробуємо обчислити собівартість з різних джерел
  let calculatedCost: number | null = null;
  /** Σ default_cost_total по документах продажу — збігається з «Аналіз продажів» у кабінеті Altegio */
  let saleDocumentsCostSum: number | null = null;
  let costItemsCount: number = 0; // Загальна кількість одиниць товару, по яких розраховано собівартість
  let costTransactionsCount: number = 0; // Кількість транзакцій, по яких успішно розраховано собівартість
  let actualCostFromGoodsTransactions: number | null = null;
  let goodsCardCost: number | null = null;
  let goodsCardGoodsList: SoldGoodItem[] | null = null;
  
  // Варіант 1: Собівартість проданого товару напряму з goods_transactions.actual_cost
  if (sales.length > 0) {
    try {
      const actualCostResult = await fetchActualCostForSalesTransactions(companyId, sales);
      if (actualCostResult.successfulTransactions > 0) {
        actualCostFromGoodsTransactions = actualCostResult.totalCost;
        costTransactionsCount = actualCostResult.successfulTransactions;
      }
    } catch (err: any) {
      console.warn(
        `[altegio/inventory] ⚠️ Не вдалося порахувати actual_cost через goods_transactions:`,
        err?.message || String(err),
      );
    }
  }

  // Варіант 2: З sale document (`data.state.items[].default_cost_total`) — fallback
  let allSaleDocumentResults: Array<{ cost: number; amount: number; itemsCount: number }> = [];
  const goodsMap = new Map<number | string, SoldGoodItem>(); // good_id або title -> товар
  
  if (sales.length > 0) {
    try {
      console.log(`[altegio/inventory] 🔍 Fetching sale documents to get default_cost_total...`);
      
      let costFromSaleDocuments = 0;
      let successfulFetches = 0;
      let failedFetches = 0;
      const processedDocumentIds = new Set<number>();
      const uniqueDocumentSales = sales.filter((sale) => {
        const documentId = getStorageSaleDocumentIdForFetch(sale);
        if (!documentId) return false;
        if (processedDocumentIds.has(documentId)) return false;
        processedDocumentIds.add(documentId);
        return true;
      });

      console.log(
        `[altegio/inventory] 📄 Унікальних sale documents: ${uniqueDocumentSales.length} з ${sales.length} складських транзакцій`,
      );
      
      const batchSize = 10;
      for (let i = 0; i < uniqueDocumentSales.length; i += batchSize) {
        const batch = uniqueDocumentSales.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (sale): Promise<{ cost: number; amount: number; itemsCount: number } | null> => {
          const documentId = getStorageSaleDocumentIdForFetch(sale);
          if (!documentId) {
            return null;
          }
          
          try {
            const saleDocumentPath = `/company/${companyId}/sale/${documentId}`;
            const saleDocument = await altegioFetch<any>(saleDocumentPath);
            const extracted = extractSaleDocumentGoods(saleDocument, sale);
            mergeGoodsIntoMap(goodsMap, extracted.goods);

            if (successfulFetches < 3) {
              console.log(
                `[altegio/inventory] 📄 Sale document ${documentId}: items=${extracted.itemsCount}, goods=${extracted.goods.length}, cost=${extracted.totalCost}`,
              );
            }

            if (extracted.itemsCount > 0 || extracted.totalCost > 0) {
              return {
                cost: extracted.totalCost,
                amount: extracted.itemsCount,
                itemsCount: extracted.itemsCount,
              };
            }

            return null;
          } catch (err: any) {
            console.log(`[altegio/inventory] ⚠️ Failed to fetch sale document ${documentId}:`, err?.message || String(err));
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter((result): result is { cost: number; amount: number; itemsCount: number } => 
          result !== null && typeof result === 'object' && 'itemsCount' in result
        );
        
        allSaleDocumentResults.push(...validResults);
        
        costFromSaleDocuments += validResults.reduce((sum, result) => sum + result.cost, 0);
        costItemsCount += validResults.reduce((sum, result) => sum + result.amount, 0);
        costTransactionsCount += validResults.filter((result) => result.cost > 0).length;
        
        const failedDocuments = batch.filter((sale, idx) => batchResults[idx] === null);
        for (const sale of failedDocuments) {
          const amount = Math.abs(Number(sale.amount) || 0);
          if (amount > 0) {
            const goodId = sale.good_id;
            const title = sale.good?.title || sale.good?.name || `Товар #${goodId || sale.id || 'N/A'}`;
            const key = goodId || title;
            const existing = goodsMap.get(key);
            
            if (existing) {
              existing.quantity += amount;
              existing.totalCost = existing.costPerUnit * existing.quantity;
            } else {
              goodsMap.set(key, {
                goodId: goodId,
                title: title,
                quantity: amount,
                costPerUnit: 0, // Не знаємо собівартість, бо документ не отримано
                totalCost: 0,
              });
            }
            
            allSaleDocumentResults.push({ cost: 0, amount: amount, itemsCount: amount });
          }
        }
        
        successfulFetches += validResults.length;
        failedFetches += batchResults.length - validResults.length;
        
        if (i + batchSize < uniqueDocumentSales.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Рахуємо загальну кількість проданих одиниць товару з усіх документів (навіть без собівартості)
      if (allSaleDocumentResults.length > 0) {
        totalItemsSold = allSaleDocumentResults.reduce((sum, result) => sum + result.itemsCount, 0);
        console.log(`[altegio/inventory] 📦 Total items sold from sale documents: ${totalItemsSold} (from ${allSaleDocumentResults.length} documents, fallback was ${totalItemsSoldFromTransactions})`);
      } else {
        console.log(`[altegio/inventory] ⚠️ No sale documents retrieved, using fallback: ${totalItemsSoldFromTransactions} items from transactions`);
      }
      
      // Якщо не зібрали товари з документів, збираємо з транзакцій складу
      if (goodsMap.size === 0 && sales.length > 0) {
        console.log(`[altegio/inventory] ⚠️ No goods collected from sale documents, collecting from storage transactions...`);
        for (const sale of sales) {
          const amount = Math.abs(Number(sale.amount) || 0);
          if (amount > 0) {
            const goodId = sale.good_id;
            const title = sale.good?.title || sale.good?.name || `Товар #${goodId || sale.id || 'N/A'}`;
            const key = goodId || title;
            const existing = goodsMap.get(key);
            
            if (existing) {
              existing.quantity += amount;
              existing.totalCost = existing.costPerUnit * existing.quantity;
            } else {
              goodsMap.set(key, {
                goodId: goodId,
                title: title,
                quantity: amount,
                costPerUnit: 0, // Не знаємо собівартість з транзакцій складу
                totalCost: 0,
              });
            }
          }
        }
        console.log(`[altegio/inventory] 📦 Collected ${goodsMap.size} goods from storage transactions`);
      }
      
      if (costFromSaleDocuments > 0) {
        saleDocumentsCostSum = costFromSaleDocuments;
        calculatedCost = costFromSaleDocuments;
        console.log(`[altegio/inventory] ✅ Calculated cost from sale documents (default_cost_total): ${calculatedCost} (documents: ${costTransactionsCount}/${uniqueDocumentSales.length}, items: ${costItemsCount}, failed: ${failedFetches})`);
        if (failedFetches > 0) {
          console.warn(
            `[altegio/inventory] ⚠️ Частина документів продажу не завантажилась (${failedFetches}) — сума з документів може бути занижена; звіряйте з кабінетом Altegio.`,
          );
        }
      } else {
        console.log(`[altegio/inventory] ⚠️ No cost found from sale documents (successful: ${successfulFetches}, failed: ${failedFetches})`);
      }
    } catch (err: any) {
      console.warn(`[altegio/inventory] ⚠️ Failed to fetch cost from sale documents:`, err?.message || String(err));
    }
  }

  if (sales.length > 0 && (saleDocumentsCostSum === null || saleDocumentsCostSum <= 0) && goodsMap.size > 0) {
    const fromMap = Array.from(goodsMap.values()).reduce(
      (acc, item) => acc + (Math.abs(Number(item.totalCost)) || 0),
      0,
    );
    const rounded = Math.round(fromMap * 100) / 100;
    if (rounded > 0) {
      saleDocumentsCostSum = rounded;
      if (calculatedCost === null || calculatedCost <= 0) {
        calculatedCost = rounded;
      }
      console.log(
        `[altegio/inventory] ✅ saleDocumentsCostSum відновлено з goodsMap (Σ totalCost): ${saleDocumentsCostSum}`,
      );
    }
  }

  // Варіант 0: Для кожного проданого good_id дістаємо детальну картку товару
  // через /goods/{location_id}/{product_id} і беремо звідти actual_cost / unit_actual_cost.
  // Увага: це «поточна» собівартість з довідника; у звіті Altegio «Аналіз продажів» зазвичай Σ default_cost_total
  // з документа продажу — тому якщо є saleDocumentsCostSum, він має пріоритет (див. фінальний вибір нижче).
  if (sales.length > 0) {
    try {
      const soldProductIds = sales
        .map((sale) => Number(sale?.good_id || sale?.good?.id || 0))
        .filter((id) => id > 0);
      const goodsById = await fetchGoodsCardsByIds(companyId, soldProductIds);
      const goodsCardResult = calculateCostFromGoodsCards(sales, goodsById);
      if (goodsCardResult.matchedGoods > 0 && goodsCardResult.totalCost > 0) {
        goodsCardCost = goodsCardResult.totalCost;
        goodsCardGoodsList = goodsCardResult.goodsList;
        // Не перезаписуємо лічильники документів продажу, якщо з них уже є сума (sale_documents має пріоритет)
        if (saleDocumentsCostSum === null || saleDocumentsCostSum <= 0) {
          costTransactionsCount = goodsCardResult.matchedGoods;
          costItemsCount = goodsCardResult.matchedItems;
        }
        console.log(
          `[altegio/inventory] ✅ Собівартість по картках товарів: ${goodsCardCost} (goods: ${goodsCardResult.matchedGoods}, items: ${goodsCardResult.matchedItems})`,
        );
        if (goodsCardResult.unmatchedGoods.length > 0) {
          console.log(
            `[altegio/inventory] ⚠️ Товари без собівартості в картці: ${goodsCardResult.unmatchedGoods.length}`,
            JSON.stringify(goodsCardResult.unmatchedGoods.slice(0, 10), null, 2),
          );
        }
      } else {
        console.log(
          `[altegio/inventory] ⚠️ Не вдалося порахувати собівартість з карток товарів`,
        );
      }
    } catch (err: any) {
      console.warn(
        `[altegio/inventory] ⚠️ Помилка розрахунку собівартості з карток товарів:`,
        err?.message || String(err),
      );
    }
  }
  
  // Варіант 1: З транзакцій закупки (type_id=2) - FALLBACK
  // Можливо, cost_per_unit або cost в транзакціях закупки містить собівартість
  if (calculatedCost === null && purchases.length > 0) {
    const purchaseCost = purchases.reduce((sum, t) => {
      // Для закупки cost_per_unit може бути оптовою ціною (собівартістю)
      const costPerUnit = Number(t.cost_per_unit) || 0;
      const amount = Math.abs(Number(t.amount) || 0);
      if (costPerUnit > 0 && amount > 0) {
        return sum + (costPerUnit * amount);
      }
      // Або cost може містити загальну суму закупки
      const totalCost = Math.abs(Number(t.cost) || 0);
      if (totalCost > 0) {
        return sum + totalCost;
      }
      return sum;
    }, 0);
    
    if (purchaseCost > 0) {
      calculatedCost = purchaseCost;
      console.log(`[altegio/inventory] ✅ Calculated cost from purchase transactions: ${calculatedCost}`);
    }
  }
  
  // Варіант 2: З транзакцій продажу (type_id=1)
  // Можливо, cost_per_unit в транзакціях продажу містить оптову ціну (собівартість)
  // Або є окреме поле для оптової ціни
  if (calculatedCost === null && sales.length > 0) {
    // Перевіряємо, чи є в транзакціях продажу поля, що можуть містити собівартість
    const sampleSale = sales[0];
    const allKeys = Object.keys(sampleSale);
    console.log(`[altegio/inventory] All keys in sales transaction:`, allKeys);
    
    const possibleCostFields = allKeys.filter(key => 
      key.toLowerCase().includes('wholesale') || 
      key.toLowerCase().includes('purchase') ||
      key.toLowerCase().includes('buy') ||
      (key.toLowerCase().includes('cost') && !key.toLowerCase().includes('per') && !key.toLowerCase().includes('total'))
    );
    
    if (possibleCostFields.length > 0) {
      console.log(`[altegio/inventory] Found possible cost fields in sales:`, possibleCostFields);
      // Спробуємо обчислити собівартість з цих полів
      const costFromSales = sales.reduce((sum, t) => {
        for (const field of possibleCostFields) {
          const value = Number((t as any)[field]) || 0;
          if (value > 0) {
            // Якщо це поле на одиницю, множимо на amount
            const amount = Math.abs(Number(t.amount) || 0);
            if (field.toLowerCase().includes('per') || field.toLowerCase().includes('unit')) {
              return sum + (value * amount);
            }
            // Інакше це загальна сума
            return sum + Math.abs(value);
          }
        }
        return sum;
      }, 0);
      
      if (costFromSales > 0) {
        calculatedCost = costFromSales;
        console.log(`[altegio/inventory] ✅ Calculated cost from sales transactions (fields: ${possibleCostFields.join(', ')}): ${calculatedCost}`);
      }
    }
    
    // Варіант 2.1: Спробуємо знайти собівартість через зв'язок з транзакціями закупки
    // Для кожного проданого товару шукаємо останню ціну закупки
    if (calculatedCost === null && purchases.length > 0) {
      console.log(`[altegio/inventory] 🔍 Trying to match sales with purchases by good_id...`);
      
      // Створюємо мапу good_id -> остання ціна закупки
      const purchasePriceMap = new Map<number, number>();
      
      // Сортуємо закупки за датою (від новіших до старіших)
      const sortedPurchases = [...purchases].sort((a, b) => {
        const dateA = new Date(a.create_date || 0).getTime();
        const dateB = new Date(b.create_date || 0).getTime();
        return dateB - dateA; // Новіші спочатку
      });
      
      for (const purchase of sortedPurchases) {
        const goodId = purchase.good_id || purchase.good?.id;
        if (goodId && !purchasePriceMap.has(goodId)) {
          const costPerUnit = Number(purchase.cost_per_unit) || 0;
          const totalCost = Math.abs(Number(purchase.cost) || 0);
          const amount = Math.abs(Number(purchase.amount) || 0);
          
          // Визначаємо ціну за одиницю
          let pricePerUnit = 0;
          if (costPerUnit > 0) {
            pricePerUnit = costPerUnit;
          } else if (totalCost > 0 && amount > 0) {
            pricePerUnit = totalCost / amount;
          }
          
          if (pricePerUnit > 0) {
            purchasePriceMap.set(goodId, pricePerUnit);
            console.log(`[altegio/inventory] Mapped good_id ${goodId} to purchase price: ${pricePerUnit}`);
          }
        }
      }
      
      // Обчислюємо собівартість для проданих товарів
      if (purchasePriceMap.size > 0) {
        const costFromMatchedPurchases = sales.reduce((sum, sale) => {
          const goodId = sale.good_id || sale.good?.id;
          const amount = Math.abs(Number(sale.amount) || 0);
          
          if (goodId && purchasePriceMap.has(goodId) && amount > 0) {
            const purchasePrice = purchasePriceMap.get(goodId)!;
            return sum + (purchasePrice * amount);
          }
          return sum;
        }, 0);
        
        if (costFromMatchedPurchases > 0) {
          calculatedCost = costFromMatchedPurchases;
          console.log(`[altegio/inventory] ✅ Calculated cost by matching sales with purchases: ${calculatedCost} (matched ${purchasePriceMap.size} goods)`);
        }
      }
    }
    
    // Варіант 2.2: Якщо в налаштуваннях API cost_per_unit тепер містить оптову ціну (собівартість)
    // Тільки якщо не знайшли інші способи
    if (calculatedCost === null) {
      const costFromCostPerUnit = sales.reduce((sum, t) => {
        const costPerUnit = Number(t.cost_per_unit) || 0;
        const amount = Math.abs(Number(t.amount) || 0);
        if (costPerUnit > 0 && amount > 0) {
          return sum + (costPerUnit * amount);
        }
        return sum;
      }, 0);
      
      if (costFromCostPerUnit > 0) {
        calculatedCost = costFromCostPerUnit;
        console.log(`[altegio/inventory] ⚠️ Using cost_per_unit as cost (may be incorrect if it's sale price): ${calculatedCost}`);
      }
    }
  }

  // Варіант 3: Спробуємо отримати собівартість з Payments API
  // Можливо, там є транзакції закупки товарів
  if (calculatedCost === null) {
    try {
      console.log(`[altegio/inventory] 🔍 Trying Payments API for cost data...`);
      const paymentsPath = `/transactions/${companyId}?start_date=${date_from}&end_date=${date_to}&real_money=1&deleted=0&count=1000`;
      const paymentsRaw = await altegioFetch<any>(paymentsPath);
      
      const paymentsTx: any[] = Array.isArray(paymentsRaw)
        ? paymentsRaw
        : paymentsRaw && typeof paymentsRaw === "object" && Array.isArray((paymentsRaw as any).data)
          ? (paymentsRaw as any).data
          : [];
      
      // Шукаємо транзакції, пов'язані з закупкою товарів
      // Можливо, вони мають type="purchase" або expense з назвою "Product purchase"
      const purchasePayments = paymentsTx.filter((t: any) => {
        const expenseTitle = t.expense?.title || t.expense?.name || "";
        return expenseTitle.toLowerCase().includes("purchase") ||
               expenseTitle.toLowerCase().includes("product purchase") ||
               expenseTitle.toLowerCase().includes("закупка") ||
               t.type === "purchase";
      });
      
      if (purchasePayments.length > 0) {
        console.log(`[altegio/inventory] Found ${purchasePayments.length} purchase transactions in Payments API`);
        const costFromPayments = purchasePayments.reduce((sum: number, t: any) => {
          const amount = Math.abs(Number(t.amount) || 0);
          return sum + amount;
        }, 0);
        
        if (costFromPayments > 0) {
          calculatedCost = costFromPayments;
          console.log(`[altegio/inventory] ✅ Calculated cost from Payments API purchase transactions: ${calculatedCost}`);
        }
      }
    } catch (err: any) {
      console.warn(`[altegio/inventory] ⚠️ Failed to fetch cost from Payments API:`, err?.message || String(err));
    }
  }

  let finalCost = 0;
  let costSource: GoodsSalesSummary["costSource"] = "none";

  if (saleDocumentsCostSum !== null && saleDocumentsCostSum > 0) {
    finalCost = saleDocumentsCostSum;
    costSource = "sale_document";
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із документів продажу (default_cost_total), як у звіті Altegio «Аналіз продажів»: ${finalCost}`,
    );
    if (goodsCardCost !== null && goodsCardCost > 0 && Math.abs(goodsCardCost - finalCost) > 1) {
      console.log(
        `[altegio/inventory] ℹ️ Для довідки: собівартість з карток товарів була б ${goodsCardCost} грн (часто вища/нижча через actual_cost довідника vs факт у документі).`,
      );
    }
  } else if (goodsCardCost !== null) {
    finalCost = goodsCardCost;
    costSource = "goods_card";
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із карток товарів: ${finalCost}`,
    );
  } else if (calculatedCost !== null) {
    finalCost = calculatedCost;
    costSource = "fallback";
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість з резервних джерел (закупівлі/поля транзакцій тощо): ${finalCost}`,
    );
  } else if (actualCostFromGoodsTransactions !== null) {
    finalCost = actualCostFromGoodsTransactions;
    costSource = "actual_cost";
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість проданого товару з goods_transactions.actual_cost: ${finalCost}`,
    );
  } else if (manualCost !== null) {
    finalCost = manualCost;
    costSource = "manual";
    console.log(`[altegio/inventory] ✅ Використовуємо ручну собівартість з KV: ${manualCost}`);
  } else {
    console.log(
      `[altegio/inventory] ⚠️ Собівартість не знайдена ні в sale document, ні в goods_transactions, ні в KV`,
    );
  }

  // Розраховуємо націнку як revenue - cost
  const profit = revenue - finalCost;
  console.log(
    `[altegio/inventory] Profit = revenue - cost: ${profit} (revenue: ${revenue}, cost: ${finalCost})`,
  );

  // Конвертуємо мапу товарів у масив та сортуємо за назвою
  const goodsListSource =
    saleDocumentsCostSum !== null && saleDocumentsCostSum > 0 && goodsMap.size > 0
      ? Array.from(goodsMap.values())
      : goodsCardGoodsList && goodsCardGoodsList.length > 0
        ? goodsCardGoodsList
        : Array.from(goodsMap.values());
  const goodsList = goodsListSource
    .sort((a, b) => a.title.localeCompare(b.title, 'uk-UA'));
  
  console.log(`[altegio/inventory] 📦 Підсумковий список товарів: ${goodsList.length} позицій`);

  const purchasesTotalUah =
    Math.round(
      purchases.reduce((sum, t) => {
        const totalLine = Math.abs(Number(t.cost) || 0);
        if (totalLine > 0) return sum + totalLine;
        const costPerUnit = Number(t.cost_per_unit) || 0;
        const amount = Math.abs(Number(t.amount) || 0);
        return sum + costPerUnit * amount;
      }, 0) * 100,
    ) / 100;
  const costOfGoodsSoldUah = Math.round(finalCost * 100) / 100;
  const impliedNetChangeUah =
    Math.round((purchasesTotalUah - costOfGoodsSoldUah) * 100) / 100;

  console.log(`[altegio/inventory] 📊 Оцінка руху складу за період: закупівлі ${purchasesTotalUah} грн, COGS ${costOfGoodsSoldUah} грн → Δ≈ ${impliedNetChangeUah} грн (type_id=2 vs cost звіту)`);

  return {
    range: { date_from, date_to },
    revenue,
    cost: finalCost,
    profit,
    costSource,
    itemsCount: sales.length,
    totalItemsSold,
    costItemsCount: costItemsCount > 0 ? costItemsCount : undefined,
    costTransactionsCount: costTransactionsCount > 0 ? costTransactionsCount : undefined,
    goodsList: goodsList.length > 0 ? goodsList : undefined,
    warehouseMovementEstimate: {
      purchasesTotalUah,
      costOfGoodsSoldUah,
      impliedNetChangeUah,
      salesTransactionsCount: sales.length,
      purchaseTransactionsCount: purchases.length,
    },
  };
}

