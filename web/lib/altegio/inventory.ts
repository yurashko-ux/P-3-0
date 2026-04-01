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

function buildSoldGoodsFromTransactions(sales: any[]): SoldGoodItem[] {
  const goodsMap = new Map<number | string, SoldGoodItem>();

  for (const sale of sales) {
    const goodId = Number(sale?.good_id || sale?.good?.id || 0);
    const quantity = Math.abs(Number(sale?.amount) || 0);
    if (quantity <= 0) continue;

    const title =
      sale?.good?.title ||
      sale?.good?.name ||
      `Товар #${goodId || sale?.id || "N/A"}`;
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

  return Array.from(goodsMap.values());
}

function calculateCostFromGoodsCards(
  soldGoods: SoldGoodItem[],
  goodsById: Map<number, any>,
): {
  totalCost: number;
  matchedGoods: number;
  matchedItems: number;
  goodsList: SoldGoodItem[];
  unmatchedGoods: Array<{ goodId?: number; title: string; quantity: number }>;
} {
  const unmatchedGoods: Array<{ goodId?: number; title: string; quantity: number }> = [];
  let totalCost = 0;
  let matchedGoods = 0;
  let matchedItems = 0;

  const goodsList = soldGoods.map((item) => ({
    goodId: item.goodId,
    title: item.title,
    quantity: item.quantity,
    costPerUnit: 0,
    totalCost: 0,
  }));

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
 * Отримати баланс складу на конкретну дату
 * Використовуємо GET /goods/{location_id} з Inventory API для отримання товарів з actual_amounts
 * Згідно з документацією: https://developer.alteg.io/api#tag/Inventory
 */
export async function getWarehouseBalance(
  params: { date: string }
): Promise<number> {
  const { date } = params;
  const companyId = resolveCompanyId();

  try {
    console.log(`[altegio/inventory] Fetching warehouse balance for date ${date} using GET /goods/${companyId}`);
    
    // Використовуємо GET /goods/{location_id} згідно з документацією Inventory API
    // Цей endpoint повертає список товарів з actual_amounts (кількості на складах)
    let path = `/goods/${companyId}`;
    let goods: any[] = [];
    
    try {
      const raw = await altegioFetch<any>(path);
      
      // Розпаковуємо дані (може бути масив або об'єкт з data/goods/items)
      goods = unwrapGoodsList(raw);
      
      console.log(`[altegio/inventory] ✅ Fetched ${goods.length} goods from GET /goods/${companyId}`);
      
      // Логуємо структуру першого товару для діагностики
      if (goods.length > 0) {
        const sampleGood = goods[0];
        console.log(`[altegio/inventory] Sample good structure:`, {
          id: sampleGood.id,
          title: sampleGood.title || sampleGood.name,
          hasActualAmounts: Array.isArray(sampleGood.actual_amounts),
          actualAmountsLength: Array.isArray(sampleGood.actual_amounts) ? sampleGood.actual_amounts.length : 0,
          defaultCostPerUnit: sampleGood.default_cost_per_unit,
          costPerUnit: sampleGood.cost_per_unit,
          allKeys: Object.keys(sampleGood).slice(0, 20),
        });
        
        // Логуємо структуру actual_amounts, якщо вона є
        if (Array.isArray(sampleGood.actual_amounts) && sampleGood.actual_amounts.length > 0) {
          console.log(`[altegio/inventory] Sample actual_amounts:`, JSON.stringify(sampleGood.actual_amounts[0], null, 2));
        }
      }
    } catch (err: any) {
      console.error(`[altegio/inventory] ❌ Failed to fetch from GET /goods/${companyId}:`, err?.message || String(err));
      
      // Fallback: спробуємо альтернативні endpoints
      const fallbackPaths = [
        `/storages/${companyId}/goods`,
        `/company/${companyId}/goods`,
      ];
      
      for (const fallbackPath of fallbackPaths) {
        try {
          console.log(`[altegio/inventory] Trying fallback: ${fallbackPath}`);
          const raw = await altegioFetch<any>(fallbackPath);
          goods = unwrapGoodsList(raw);
          
          if (goods.length > 0) {
            console.log(`[altegio/inventory] ✅ Fetched ${goods.length} goods from ${fallbackPath}`);
            break;
          }
        } catch (err2: any) {
          console.log(`[altegio/inventory] ❌ Failed to fetch from ${fallbackPath}:`, err2?.message);
        }
      }
    }

    // Якщо не вдалося отримати список товарів, спробуємо розрахувати через транзакції
    if (goods.length === 0) {
      console.log(`[altegio/inventory] ⚠️ No goods found from direct API, calculating balance from transactions...`);
      
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

      // Рахуємо баланс як суму закупок (type_id = 2) мінус продажі (type_id = 1)
      // Використовуємо собівартість (cost_per_unit), а не ціну продажу
      const balance = tx.reduce((sum, t) => {
        const typeId = Number(t.type_id);
        const amount = Math.abs(Number(t.amount) || 0);
        const costPerUnit = Number(t.cost_per_unit) || 0;
        
        if (amount > 0 && costPerUnit > 0) {
          const value = amount * costPerUnit;
          // type_id = 1 (продаж) - зменшує баланс
          // type_id = 2 (закупівля) - збільшує баланс
          return sum + (typeId === 1 ? -value : value);
        }
        return sum;
      }, 0);

      console.log(`[altegio/inventory] Warehouse balance on ${date} (calculated from transactions): ${balance} (from ${tx.length} transactions)`);
      return balance;
    }

    // Рахуємо баланс як суму (кількість * собівартість) для всіх товарів на складі
    // Використовуємо actual_amounts для отримання кількості на кожному складі
    let totalBalance = 0;
    let goodsWithStock = 0;
    let goodsWithoutStock = 0;
    
    for (const good of goods) {
      // Отримуємо собівартість товару
      const costPerUnit = Number(good.default_cost_per_unit) ||
        Number(good.cost_per_unit) ||
        Number(good.cost) ||
        Number(good.purchase_price) ||
        Number(good.wholesale_price) ||
        0;
      
      if (costPerUnit <= 0) {
        continue; // Пропускаємо товари без собівартості
      }
      
      // Отримуємо загальну кількість товару на всіх складах
      let totalQuantity = 0;
      
      // Варіант 1: Використовуємо actual_amounts (масив об'єктів з кількістю на кожному складі)
      if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
        totalQuantity = good.actual_amounts.reduce((sum: number, amount: any) => {
          // actual_amounts може бути масивом об'єктів { storage_id, amount } або просто чисел
          const qty = typeof amount === 'object' && amount !== null
            ? Math.abs(Number(amount.amount) || Number(amount.quantity) || Number(amount.count) || 0)
            : Math.abs(Number(amount) || 0);
          return sum + qty;
        }, 0);
      }
      
      // Варіант 2: Якщо actual_amounts немає, спробуємо інші поля
      if (totalQuantity === 0) {
        totalQuantity = Math.abs(
          Number(good.amount) ||
          Number(good.quantity) ||
          Number(good.count) ||
          Number(good.qty) ||
          Number(good.balance) ||
          Number(good.stock) ||
          Number(good.total_amount) ||
          0
        );
      }
      
      if (totalQuantity > 0 && costPerUnit > 0) {
        const goodValue = totalQuantity * costPerUnit;
        totalBalance += goodValue;
        goodsWithStock++;
      } else {
        goodsWithoutStock++;
      }
    }

    console.log(`[altegio/inventory] ✅ Warehouse balance on ${date}: ${totalBalance} UAH`);
    console.log(`[altegio/inventory]   - Goods with stock: ${goodsWithStock}`);
    console.log(`[altegio/inventory]   - Goods without stock/cost: ${goodsWithoutStock}`);
    console.log(`[altegio/inventory]   - Total goods processed: ${goods.length}`);
    
    return totalBalance;
  } catch (error: any) {
    console.error(`[altegio/inventory] ❌ Failed to get warehouse balance:`, error?.message || String(error));
    return 0;
  }
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
        const documentId = Number((sale as any).document_id || sale.id || 0);
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
          const documentId = (sale as any).document_id || sale.id;
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
        calculatedCost = costFromSaleDocuments;
        console.log(`[altegio/inventory] ✅ Calculated cost from sale documents (default_cost_total): ${calculatedCost} (documents: ${costTransactionsCount}/${uniqueDocumentSales.length}, items: ${costItemsCount}, failed: ${failedFetches})`);
      } else {
        console.log(`[altegio/inventory] ⚠️ No cost found from sale documents (successful: ${successfulFetches}, failed: ${failedFetches})`);
      }
    } catch (err: any) {
      console.warn(`[altegio/inventory] ⚠️ Failed to fetch cost from sale documents:`, err?.message || String(err));
    }
  }

  // Варіант 0: Собівартість беремо з детальних карток товарів,
  // а кількість — зі списку проданих товарів із sale documents.
  if (sales.length > 0) {
    try {
      const soldGoodsForCardCost = goodsMap.size > 0
        ? Array.from(goodsMap.values()).map((item) => ({
            goodId: item.goodId,
            title: item.title,
            quantity: item.quantity,
            costPerUnit: 0,
            totalCost: 0,
          }))
        : buildSoldGoodsFromTransactions(sales);
      const soldProductIds = soldGoodsForCardCost
        .map((item) => Number(item.goodId || 0))
        .filter((id) => id > 0);
      const goodsById = await fetchGoodsCardsByIds(companyId, soldProductIds);
      const goodsCardResult = calculateCostFromGoodsCards(soldGoodsForCardCost, goodsById);
      if (goodsCardResult.matchedGoods > 0 && goodsCardResult.totalCost > 0) {
        goodsCardCost = goodsCardResult.totalCost;
        goodsCardGoodsList = goodsCardResult.goodsList;
        costTransactionsCount = goodsCardResult.matchedGoods;
        costItemsCount = goodsCardResult.matchedItems;
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

  if (goodsCardCost !== null) {
    finalCost = goodsCardCost;
    costSource = "goods_card";
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із карток товарів: ${finalCost}`,
    );
  } else if (calculatedCost !== null) {
    finalCost = calculatedCost;
    costSource = "sale_document";
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із sale document default_cost_total: ${finalCost}`,
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
  const goodsListSource = goodsCardGoodsList && goodsCardGoodsList.length > 0
    ? goodsCardGoodsList
    : Array.from(goodsMap.values());
  const goodsList = goodsListSource
    .sort((a, b) => a.title.localeCompare(b.title, 'uk-UA'));
  
  console.log(`[altegio/inventory] 📦 Підсумковий список товарів: ${goodsList.length} позицій`);
  
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
  };
}

