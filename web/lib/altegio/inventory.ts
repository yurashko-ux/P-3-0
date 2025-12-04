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

// Тип деталей товару з API
export type AltegioGood = {
  id: number;
  title?: string;
  actual_cost?: number; // Собівартість (ціна закупки)
  cost?: number; // Може бути ціна продажу
  [key: string]: any;
};

/** Агрегована інформація по продажах товарів за період */
export type GoodsSalesSummary = {
  range: { date_from: string; date_to: string };
  revenue: number;
  cost: number;
  profit: number;
  itemsCount: number;
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

/**
 * Отримати деталі товару за ID, включаючи actual_cost (собівартість)
 */
async function fetchGoodDetails(
  locationId: string,
  productId: number,
): Promise<AltegioGood | null> {
  try {
    const path = `/goods/${locationId}/${productId}`;
    const response = await altegioFetch<AltegioGood | { data?: AltegioGood }>(
      path,
    );

    // Розпаковуємо дані
    let good: AltegioGood | null = null;
    if (response && typeof response === "object") {
      if ("id" in response) {
        good = response as AltegioGood;
      } else if ("data" in response && response.data) {
        good = response.data as AltegioGood;
      }
    }

    return good;
  } catch (err) {
    console.error(
      `[altegio/inventory] Failed to fetch good ${productId} from location ${locationId}:`,
      err,
    );
    return null;
  }
}

/**
 * Отримати агреговану виручку / собівартість / націнку по товарах із inventory transactions за період.
 *
 * Використовуємо `/storages/transactions/{locationId}` для отримання транзакцій продажу,
 * а потім для кожного унікального товару викликаємо `/goods/{location_id}/{product_id}`
 * щоб отримати `actual_cost` (собівартість/ціна закупки).
 *
 * Припущення:
 * - `cost` у транзакції продажу = виручка по товару (Total cost у звіті)
 * - `actual_cost` з `/goods/{location_id}/{product_id}` = собівартість (ціна закупки)
 * - `amount` = кількість проданих одиниць (може бути від'ємним для повернень)
 *
 * Тоді:
 *   revenue = Σ |cost| (для type_id = 1)
 *   cost    = Σ (actual_cost * |amount|) для кожного товару
 *   profit  = revenue - cost
 */
export async function fetchGoodsSalesSummary(params: {
  date_from: string;
  date_to: string;
}): Promise<GoodsSalesSummary> {
  const { date_from, date_to } = params;
  const companyId = resolveCompanyId();

  const qs = new URLSearchParams({
    start_date: date_from,
    end_date: date_to,
  });

  const path = `/storages/transactions/${companyId}?${qs.toString()}`;

  const raw = await altegioFetch<any>(path);

  // Розпаковуємо дані (може бути масив або об'єкт з data)
  const tx: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : [];

  // Логуємо структуру для діагностики
  console.log(
    `[altegio/inventory] transactions response:`,
    JSON.stringify(
      {
        totalTransactions: tx.length,
        typeIds: [...new Set(tx.map((t) => t.type_id))].sort(),
        sampleTransaction:
          tx.length > 0
            ? {
                id: tx[0].id,
                type_id: tx[0].type_id,
                amount: tx[0].amount,
                good_id: tx[0].good_id,
                cost_per_unit: tx[0].cost_per_unit,
                cost: tx[0].cost,
                allKeys: Object.keys(tx[0]),
              }
            : null,
      },
      null,
      2,
    ),
  );

  // type_id = 1 — продаж товарів (Sale of goods)
  // Беремо всі транзакції типу 1 (продажі), включаючи повернення
  const sales = tx.filter((t) => Number(t.type_id) === 1);

  console.log(
    `[altegio/inventory] filtered sales (type_id=1): ${sales.length} items`,
    JSON.stringify({
      amounts: sales.map((t) => Number(t.amount)),
      positiveAmounts: sales.filter((t) => Number(t.amount) > 0).length,
      negativeAmounts: sales.filter((t) => Number(t.amount) < 0).length,
      uniqueGoodIds: [...new Set(sales.map((t) => t.good_id).filter(Boolean))],
    }),
  );

  // Розраховуємо виручку (сума всіх cost, використовуючи абсолютне значення)
  const revenue = sales.reduce(
    (sum, t) => sum + Math.abs(Number(t.cost) || 0),
    0,
  );

  // Отримуємо унікальні ID товарів з транзакцій
  const uniqueGoodIds = [
    ...new Set(
      sales
        .map((t) => t.good_id || t.good?.id)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  ];

  console.log(
    `[altegio/inventory] Fetching details for ${uniqueGoodIds.length} unique products...`,
  );

  // Створюємо мапу: good_id -> actual_cost
  const goodCostMap = new Map<number, number>();

  // Отримуємо деталі кожного товару для отримання actual_cost
  // Обмежуємо кількість одночасних запитів, щоб не перевищити rate limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < uniqueGoodIds.length; i += BATCH_SIZE) {
    const batch = uniqueGoodIds.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map((goodId) =>
      fetchGoodDetails(companyId, goodId).then((good) => {
        if (good && good.actual_cost !== undefined) {
          goodCostMap.set(goodId, Number(good.actual_cost) || 0);
          console.log(
            `[altegio/inventory] Good ${goodId}: actual_cost = ${good.actual_cost}`,
          );
        } else {
          console.warn(
            `[altegio/inventory] Good ${goodId}: actual_cost not found`,
            good ? Object.keys(good) : "good is null",
          );
        }
      }),
    );

    await Promise.all(batchPromises);

    // Невелика затримка між батчами, щоб не перевищити rate limit (5/сек)
    if (i + BATCH_SIZE < uniqueGoodIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 250)); // 250ms = ~4 запити/сек
    }
  }

  console.log(
    `[altegio/inventory] Fetched costs for ${goodCostMap.size} products`,
  );

  // Розраховуємо собівартість: для кожної транзакції множимо actual_cost на кількість
  let cost = 0;
  let costCalculatedCount = 0;
  let costMissingCount = 0;

  for (const t of sales) {
    const goodId = t.good_id || t.good?.id;
    if (!goodId) {
      continue;
    }

    const actualCost = goodCostMap.get(goodId);
    if (actualCost !== undefined) {
      const amount = Math.abs(Number(t.amount) || 0);
      cost += actualCost * amount;
      costCalculatedCount++;
    } else {
      costMissingCount++;
      console.warn(
        `[altegio/inventory] Missing actual_cost for good_id ${goodId} in transaction ${t.id}`,
      );
    }
  }

  console.log(
    `[altegio/inventory] Cost calculation:`,
    JSON.stringify({
      costCalculatedCount,
      costMissingCount,
      totalCost: cost,
    }),
  );

  const profit = revenue - cost;

  return {
    range: { date_from, date_to },
    revenue,
    cost,
    profit,
    itemsCount: sales.length,
  };
}

