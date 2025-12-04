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
  document_id?: number; // ID документа операції (може містити ціну закупки)
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
 * Отримати деталі документа операції складу за ID
 * Може містити інформацію про ціну закупки товарів
 */
async function fetchDocumentDetails(
  locationId: string,
  documentId: number,
): Promise<any | null> {
  try {
    // Спробуємо різні варіанти endpoint'ів для документів
    const paths = [
      `/storage_operations/documents/${locationId}/${documentId}`,
      `/storages/documents/${locationId}/${documentId}`,
      `/storage_operations/${locationId}/documents/${documentId}`,
    ];

    for (const path of paths) {
      try {
        const response = await altegioFetch<any>(path);
        if (response) {
          console.log(
            `[altegio/inventory] Document ${documentId} structure:`,
            JSON.stringify(
              {
                path,
                allKeys: Object.keys(response),
                numericFields: Object.entries(response)
                  .filter(([_, v]) => typeof v === "number")
                  .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
                costFields: Object.entries(response)
                  .filter(([k]) => k.toLowerCase().includes("cost"))
                  .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
                purchaseFields: Object.entries(response)
                  .filter(([k]) =>
                    k.toLowerCase().includes("purchase") ||
                    k.toLowerCase().includes("wholesale") ||
                    k.toLowerCase().includes("закуп") ||
                    k.toLowerCase().includes("собіварт") ||
                    k.toLowerCase().includes("arrival") ||
                    k.toLowerCase().includes("incoming"),
                  )
                  .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
                goods: Array.isArray(response.goods)
                  ? response.goods.slice(0, 2).map((g: any) => ({
                      id: g.id,
                      good_id: g.good_id,
                      cost: g.cost,
                      cost_per_unit: g.cost_per_unit,
                      purchase_price: g.purchase_price,
                      wholesale_cost: g.wholesale_cost,
                      allKeys: Object.keys(g),
                    }))
                  : response.goods,
              },
              null,
              2,
            ).substring(0, 2000),
          );
          return response;
        }
      } catch (err: any) {
        if (err.status === 404) {
          continue; // Спробуємо наступний варіант
        }
        throw err;
      }
    }

    return null;
  } catch (err) {
    console.error(
      `[altegio/inventory] Failed to fetch document ${documentId} from location ${locationId}:`,
      err,
    );
    return null;
  }
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

    // Детальне логування структури товару для діагностики
    if (good) {
      console.log(
        `[altegio/inventory] Good ${productId} structure:`,
        JSON.stringify(
          {
            id: good.id,
            title: good.title,
            actual_cost: good.actual_cost,
            cost: good.cost,
            allKeys: Object.keys(good),
            // Логуємо всі числові поля, які можуть бути собівартістю
            numericFields: Object.entries(good)
              .filter(([_, v]) => typeof v === "number")
              .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
            // Логуємо всі поля, що містять "cost" в назві
            costFields: Object.entries(good)
              .filter(([k]) => k.toLowerCase().includes("cost"))
              .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
            // Логуємо всі поля, що містять "price" в назві
            priceFields: Object.entries(good)
              .filter(([k]) => k.toLowerCase().includes("price"))
              .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
            // Логуємо всі поля, що містять "purchase" або "wholesale" в назві
            purchaseFields: Object.entries(good)
              .filter(([k]) =>
                k.toLowerCase().includes("purchase") ||
                k.toLowerCase().includes("wholesale") ||
                k.toLowerCase().includes("закуп") ||
                k.toLowerCase().includes("собіварт"),
              )
              .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
          },
          null,
          2,
        ),
      );
    } else {
      console.warn(
        `[altegio/inventory] Good ${productId} response structure:`,
        JSON.stringify(response, null, 2).substring(0, 500),
      );
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

  // Логуємо структуру відповіді для діагностики
  console.log(
    `[altegio/inventory] Raw transactions response structure:`,
    JSON.stringify(
      {
        isArray: Array.isArray(raw),
        hasData: raw && typeof raw === "object" && "data" in raw,
        dataIsArray:
          raw && typeof raw === "object" && Array.isArray((raw as any).data),
        keys: raw && typeof raw === "object" ? Object.keys(raw) : [],
        totalInResponse:
          raw && typeof raw === "object" && "total" in raw
            ? (raw as any).total
            : Array.isArray(raw)
              ? raw.length
              : raw && typeof raw === "object" && Array.isArray((raw as any).data)
                ? (raw as any).data.length
                : "unknown",
      },
      null,
      2,
    ),
  );

  // Розпаковуємо дані (може бути масив або об'єкт з data)
  const tx: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : [];

  // Логуємо структуру для діагностики
  const sampleTx = tx.length > 0 ? tx[0] : null;
  console.log(
    `[altegio/inventory] transactions response:`,
    JSON.stringify(
      {
        totalTransactions: tx.length,
        typeIds: [...new Set(tx.map((t) => t.type_id))].sort(),
        sampleTransaction: sampleTx
          ? {
              id: sampleTx.id,
              type_id: sampleTx.type_id,
              amount: sampleTx.amount,
              good_id: sampleTx.good_id,
              document_id: sampleTx.document_id, // Перевіряємо наявність document_id
              good: sampleTx.good, // Логуємо об'єкт good
              cost_per_unit: sampleTx.cost_per_unit,
              cost: sampleTx.cost,
              allKeys: Object.keys(sampleTx),
              // Логуємо всі числові поля
              numericFields: Object.entries(sampleTx)
                .filter(([_, v]) => typeof v === "number")
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
              // Логуємо всі поля з "cost" в назві
              costFields: Object.entries(sampleTx)
                .filter(([k]) => k.toLowerCase().includes("cost"))
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
              // Логуємо всі поля з "price" в назві
              priceFields: Object.entries(sampleTx)
                .filter(([k]) => k.toLowerCase().includes("price"))
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
              // Логуємо поля, що можуть містити ціну закупки
              purchaseFields: Object.entries(sampleTx)
                .filter(([k]) =>
                  k.toLowerCase().includes("purchase") ||
                  k.toLowerCase().includes("wholesale") ||
                  k.toLowerCase().includes("закуп") ||
                  k.toLowerCase().includes("собіварт") ||
                  k.toLowerCase().includes("arrival") ||
                  k.toLowerCase().includes("incoming"),
                )
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
            }
          : null,
        transactionsWithDocumentId: tx.filter((t) => t.document_id).length,
      },
      null,
      2,
    ),
  );

  // type_id = 1 — продаж товарів (Sale of goods)
  // Беремо всі транзакції типу 1 (продажі), включаючи повернення
  const sales = tx.filter((t) => Number(t.type_id) === 1);

  // Витягуємо good_id з транзакцій (може бути в good_id або в good.id або good.good_id)
  const extractGoodId = (t: any): number | null => {
    if (t.good_id) return Number(t.good_id);
    if (t.good?.id) return Number(t.good.id);
    if (t.good?.good_id) return Number(t.good.good_id);
    return null;
  };

  // Перевіряємо, чи є в транзакціях поля з ціною закупки
  const sampleSales = sales.slice(0, 3);
  const transactionPurchasePriceFields = sampleSales.map((t) => {
    const purchaseFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(t)) {
      if (
        typeof k === "string" &&
        (k.toLowerCase().includes("purchase") ||
          k.toLowerCase().includes("wholesale") ||
          k.toLowerCase().includes("закуп") ||
          k.toLowerCase().includes("собіварт") ||
          k.toLowerCase().includes("arrival") ||
          k.toLowerCase().includes("incoming") ||
          k.toLowerCase().includes("buy"))
      ) {
        purchaseFields[k] = v;
      }
    }
    // Також перевіряємо об'єкт good, якщо він є
    if (t.good && typeof t.good === "object") {
      for (const [k, v] of Object.entries(t.good)) {
        if (
          typeof k === "string" &&
          (k.toLowerCase().includes("purchase") ||
            k.toLowerCase().includes("wholesale") ||
            k.toLowerCase().includes("закуп") ||
            k.toLowerCase().includes("собіварт") ||
            k.toLowerCase().includes("cost"))
        ) {
          purchaseFields[`good.${k}`] = v;
        }
      }
    }
    return {
      transactionId: t.id,
      goodId: extractGoodId(t),
      purchaseFields,
      allNumericFields: Object.entries(t)
        .filter(([_, v]) => typeof v === "number")
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    };
  });

  console.log(
    `[altegio/inventory] filtered sales (type_id=1): ${sales.length} items`,
    JSON.stringify(
      {
        amounts: sales.map((t) => Number(t.amount)),
        positiveAmounts: sales.filter((t) => Number(t.amount) > 0).length,
        negativeAmounts: sales.filter((t) => Number(t.amount) < 0).length,
        uniqueGoodIds: [
          ...new Set(
            sales.map(extractGoodId).filter((id): id is number => id !== null),
          ),
        ],
        sampleGoodIds: sales
          .slice(0, 5)
          .map((t) => ({
            good_id: t.good_id,
            good: t.good,
            extracted: extractGoodId(t),
          })),
        transactionPurchasePriceFields,
      },
      null,
      2,
    ),
  );

  // Розраховуємо виручку: використовуємо cost_per_unit * amount (бо t.cost часто = 0)
  // Для продажів amount зазвичай від'ємний (зменшення складу), тому беремо абсолютне значення
  const revenue = sales.reduce(
    (sum, t) => {
      const amount = Math.abs(Number(t.amount) || 0);
      const costPerUnit = Number(t.cost_per_unit) || 0;
      // Якщо cost_per_unit = 0, спробуємо використати cost (якщо він не 0)
      const unitPrice = costPerUnit > 0 ? costPerUnit : Math.abs(Number(t.cost) || 0);
      return sum + amount * unitPrice;
    },
    0,
  );

  // Отримуємо унікальні ID товарів з транзакцій
  const uniqueGoodIds = [
    ...new Set(
      sales
        .map(extractGoodId)
        .filter((id): id is number => id !== null && id > 0),
    ),
  ];

  console.log(
    `[altegio/inventory] Fetching details for ${uniqueGoodIds.length} unique products...`,
  );

  // Створюємо мапу: good_id -> actual_cost (або інше поле з собівартістю)
  const goodCostMap = new Map<number, number>();

  // Спочатку спробуємо отримати ціни закупки з документів операцій (якщо є document_id)
  const uniqueDocumentIds = [
    ...new Set(
      sales
        .map((t) => t.document_id)
        .filter((id): id is number => id !== null && id !== undefined && id > 0),
    ),
  ];

  if (uniqueDocumentIds.length > 0) {
    console.log(
      `[altegio/inventory] Found ${uniqueDocumentIds.length} unique document IDs, fetching document details...`,
    );

    // Отримуємо деталі документів (обмежуємо кількість для діагностики)
    const documentSampleSize = Math.min(5, uniqueDocumentIds.length);
    for (let i = 0; i < documentSampleSize; i++) {
      const docId = uniqueDocumentIds[i];
      const doc = await fetchDocumentDetails(companyId, docId);
      if (doc) {
        // Якщо документ містить товари з цінами закупки, логуємо це
        if (Array.isArray(doc.goods)) {
          console.log(
            `[altegio/inventory] Document ${docId} contains ${doc.goods.length} goods`,
          );
        }
      }
      // Невелика затримка між запитами
      if (i < documentSampleSize - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  // Отримуємо деталі кожного товару для отримання actual_cost
  // Обмежуємо кількість одночасних запитів, щоб не перевищити rate limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < uniqueGoodIds.length; i += BATCH_SIZE) {
    const batch = uniqueGoodIds.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map((goodId) =>
      fetchGoodDetails(companyId, goodId).then((good) => {
        if (!good) {
          console.warn(
            `[altegio/inventory] Good ${goodId}: failed to fetch details`,
          );
          return;
        }

        // Спробуємо знайти собівартість в різних полях
        // Пріоритет: actual_cost > cost > інші поля з "cost" в назві
        let costValue: number | undefined = undefined;

        if (good.actual_cost !== undefined && good.actual_cost !== null) {
          costValue = Number(good.actual_cost);
        } else if (good.cost !== undefined && good.cost !== null) {
          // Може бути, що cost - це собівартість, а не ціна продажу
          costValue = Number(good.cost);
        } else {
          // Шукаємо інші поля з "cost" в назві
          const costFields = Object.entries(good).filter(([k]) =>
            k.toLowerCase().includes("cost"),
          );
          if (costFields.length > 0) {
            console.log(
              `[altegio/inventory] Good ${goodId}: found cost fields:`,
              costFields.map(([k, v]) => `${k}=${v}`).join(", "),
            );
            // Спробуємо взяти перше числове значення
            for (const [_, v] of costFields) {
              if (typeof v === "number" && v > 0) {
                costValue = v;
                break;
              }
            }
          }
        }

        if (costValue !== undefined && costValue > 0) {
          goodCostMap.set(goodId, costValue);
          console.log(
            `[altegio/inventory] Good ${goodId}: using cost = ${costValue}`,
          );
        } else {
          console.warn(
            `[altegio/inventory] Good ${goodId}: no valid cost found. actual_cost=${good.actual_cost}, cost=${good.cost}`,
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
    const goodId = extractGoodId(t);
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

  // Логуємо детальну статистику по розрахунку собівартості
  const costByGoodId = new Map<number, { count: number; totalCost: number }>();
  for (const t of sales) {
    const goodId = extractGoodId(t);
    if (!goodId) continue;
    const actualCost = goodCostMap.get(goodId);
    if (actualCost !== undefined) {
      const amount = Math.abs(Number(t.amount) || 0);
      const transactionCost = actualCost * amount;
      const existing = costByGoodId.get(goodId) || { count: 0, totalCost: 0 };
      costByGoodId.set(goodId, {
        count: existing.count + 1,
        totalCost: existing.totalCost + transactionCost,
      });
    }
  }

  console.log(
    `[altegio/inventory] Cost calculation details:`,
    JSON.stringify(
      {
        costCalculatedCount,
        costMissingCount,
        totalCost: cost,
        revenue,
        calculatedProfit: revenue - cost,
        goodsWithCost: costByGoodId.size,
        topGoodsByCost: Array.from(costByGoodId.entries())
          .sort((a, b) => b[1].totalCost - a[1].totalCost)
          .slice(0, 10)
          .map(([goodId, data]) => ({
            goodId,
            transactions: data.count,
            cost: data.totalCost,
            costPerUnit: goodCostMap.get(goodId),
          })),
      },
      null,
      2,
    ),
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

