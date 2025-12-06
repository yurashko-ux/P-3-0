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


/**
 * Отримати агреговану виручку / собівартість / націнку по товарах із inventory transactions за період.
 *
 * Використовуємо `/storages/transactions/{locationId}` для отримання транзакцій продажу.
 * Собівартість береться з ручно введеного значення (зберігається в KV).
 * Якщо ручне значення не встановлено, собівартість = 0.
 *
 * Припущення:
 * - `cost` у транзакції продажу = виручка по товару (Total cost у звіті)
 * - Собівартість встановлюється вручну через UI (захищено CRON_SECRET)
 * - `amount` = кількість проданих одиниць (може бути від'ємним для повернень)
 *
 * Тоді:
 *   revenue = Σ |cost| (для type_id = 1)
 *   cost    = ручно введене значення (з KV) або 0
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
  
  // Варіант 0: З API Sales Transaction (default_cost_per_unit) - ПРІОРИТЕТНИЙ МЕТОД
  // Використовуємо GET /company/{location_id}/sale/{document_id} для отримання default_cost_per_unit
  // Також рахуємо загальну кількість проданих одиниць товару з документів продажу
  let allSaleDocumentResults: Array<{ cost: number; amount: number; itemsCount: number }> = [];
  const goodsMap = new Map<number | string, SoldGoodItem>(); // good_id або title -> товар
  
  if (sales.length > 0) {
    try {
      console.log(`[altegio/inventory] 🔍 Fetching sale documents to get default_cost_per_unit...`);
      
      let costFromSaleDocuments = 0;
      let successfulFetches = 0;
      let failedFetches = 0;
      let hasLoggedDocumentStructure = false; // Для відстеження, чи вже залоговано структуру документа
      
      // Обмежуємо кількість одночасних запитів для уникнення rate limiting
      // Обробляємо транзакції пакетами
      const batchSize = 10;
      for (let i = 0; i < sales.length; i += batchSize) {
        const batch = sales.slice(i, i + batchSize);
        
        // Обробляємо пакет паралельно
        const batchPromises = batch.map(async (sale): Promise<{ cost: number; amount: number; itemsCount: number } | null> => {
          // Перевіряємо, чи є document_id в транзакції, інакше використовуємо id
          const documentId = (sale as any).document_id || sale.id;
          const amount = Math.abs(Number(sale.amount) || 0);
          
          if (!documentId) {
            return null;
          }
          
          try {
            // Використовуємо document_id (або transaction id) для sale endpoint
            const saleDocumentPath = `/company/${companyId}/sale/${documentId}`;
            const saleDocument = await altegioFetch<any>(saleDocumentPath);
            
            // Рахуємо загальну кількість позицій у документі продажу
            let itemsCountInDocument = 0;
            
            // Перевіряємо масив items
            if (Array.isArray(saleDocument.items)) {
              // Логуємо структуру items для діагностики (тільки для першого документа)
              if (successfulFetches === 0) {
                console.log(`[altegio/inventory] 📋 Sample sale document items structure:`, JSON.stringify(saleDocument.items.slice(0, 3), null, 2));
                console.log(`[altegio/inventory] 📋 Full sale document keys:`, Object.keys(saleDocument));
              }
              
              // Рахуємо суму amount/quantity з кожного item
              itemsCountInDocument = saleDocument.items.reduce((sum: number, item: any) => {
                // Спробуємо різні поля для кількості
                const itemAmount = Math.abs(
                  Number(item.amount) || 
                  Number(item.quantity) || 
                  Number(item.count) || 
                  Number(item.qty) ||
                  Number(item.amount_sold) ||
                  0
                );
                
                // Логуємо структуру першого item для діагностики
                if (successfulFetches === 0 && sum === 0) {
                  console.log(`[altegio/inventory] 📋 Sample item structure:`, JSON.stringify(item, null, 2));
                }
                
                return sum + itemAmount;
              }, 0);
              
              // Якщо сума = 0, але є items, можливо потрібно рахувати кількість items
              if (itemsCountInDocument === 0 && saleDocument.items.length > 0) {
                // Можливо, кожен item = 1 одиниця товару
                itemsCountInDocument = saleDocument.items.length;
                console.log(`[altegio/inventory] ⚠️ Items array has no amount/quantity, using items.length: ${itemsCountInDocument}`);
              }
            }
            
            // Перевіряємо масив goods (альтернативна структура)
            if (itemsCountInDocument === 0 && Array.isArray(saleDocument.goods)) {
              itemsCountInDocument = saleDocument.goods.reduce((sum: number, good: any) => {
                const goodAmount = Math.abs(
                  Number(good.amount) || 
                  Number(good.quantity) || 
                  Number(good.count) || 
                  Number(good.qty) ||
                  0
                );
                return sum + goodAmount;
              }, 0);
              
              // Якщо сума = 0, але є goods, можливо потрібно рахувати кількість goods
              if (itemsCountInDocument === 0 && saleDocument.goods.length > 0) {
                itemsCountInDocument = saleDocument.goods.length;
              }
            }
            
            // Перевіряємо інші можливі поля
            if (itemsCountInDocument === 0) {
              // Можливо, кількість на рівні документа
              const docQuantity = Math.abs(Number(saleDocument.quantity) || Number(saleDocument.total_quantity) || 0);
              if (docQuantity > 0) {
                itemsCountInDocument = docQuantity;
              }
            }
            
            // Якщо не знайшли в items/goods, використовуємо amount з транзакції
            if (itemsCountInDocument === 0 && amount > 0) {
              itemsCountInDocument = amount;
            }
            
            // Логуємо для діагностики (тільки для перших кількох документів)
            if (successfulFetches < 3) {
              console.log(`[altegio/inventory] 📄 Sale document ${documentId}: itemsCount=${itemsCountInDocument}, hasItems=${Array.isArray(saleDocument.items)}, hasGoods=${Array.isArray(saleDocument.goods)}, docKeys=${Object.keys(saleDocument).slice(0, 10).join(', ')}`);
            }
            
            // Шукаємо default_cost_per_unit в документі
            // Може бути на рівні документа або в масиві items/goods
            let defaultCostPerUnit: number | null = null;
            
            // Перевіряємо прямий доступ до поля
            if (typeof saleDocument.default_cost_per_unit === 'number') {
              defaultCostPerUnit = saleDocument.default_cost_per_unit;
            }
            
            // Збираємо інформацію про товари з документа продажу
            // Обробляємо масив items (якщо є кілька товарів у документі)
            if (Array.isArray(saleDocument.items)) {
              for (const item of saleDocument.items) {
                const goodId = item.good_id || item.good?.id || item.id;
                const title = item.good?.title || item.good?.name || item.title || item.name || `Товар #${goodId || 'N/A'}`;
                const quantity = Math.abs(
                  Number(item.amount) || 
                  Number(item.quantity) || 
                  Number(item.count) || 
                  Number(item.qty) ||
                  1
                );
                const itemCostPerUnit = item.default_cost_per_unit || defaultCostPerUnit || 0;
                
                if (quantity > 0) {
                  const key = goodId || title;
                  const existing = goodsMap.get(key);
                  
                  if (existing) {
                    // Агрегуємо дані для існуючого товару
                    existing.quantity += quantity;
                    if (itemCostPerUnit > 0) {
                      // Оновлюємо собівартість, якщо знайшли
                      if (existing.costPerUnit === 0) {
                        existing.costPerUnit = itemCostPerUnit;
                      } else {
                        // Середнє значення собівартості (якщо різні ціни)
                        existing.costPerUnit = (existing.costPerUnit * (existing.quantity - quantity) + itemCostPerUnit * quantity) / existing.quantity;
                      }
                      existing.totalCost = existing.costPerUnit * existing.quantity;
                    }
                  } else {
                    // Створюємо новий запис
                    goodsMap.set(key, {
                      goodId: goodId,
                      title: title,
                      quantity: quantity,
                      costPerUnit: itemCostPerUnit,
                      totalCost: itemCostPerUnit * quantity,
                    });
                  }
                }
              }
            }
            
            // Перевіряємо в масиві items/goods (якщо є кілька товарів)
            if (defaultCostPerUnit === null && Array.isArray(saleDocument.items)) {
              // Якщо в документі кілька товарів, беремо середнє або суму
              // Але зазвичай для однієї транзакції один товар
              const item = saleDocument.items.find((item: any) => 
                item.good_id === sale.good_id || 
                item.good?.id === sale.good_id ||
                item.id === sale.good_id
              ) || saleDocument.items[0];
              
              if (item && typeof item.default_cost_per_unit === 'number') {
                defaultCostPerUnit = item.default_cost_per_unit;
              }
            }
            
            // Перевіряємо в масиві goods (альтернативна структура)
            if (defaultCostPerUnit === null && Array.isArray(saleDocument.goods)) {
              const good = saleDocument.goods.find((good: any) => 
                good.id === sale.good_id || 
                good.good_id === sale.good_id
              ) || saleDocument.goods[0];
              
              if (good && typeof good.default_cost_per_unit === 'number') {
                defaultCostPerUnit = good.default_cost_per_unit;
              }
            }
            
            if (defaultCostPerUnit !== null && defaultCostPerUnit > 0) {
              // Використовуємо itemsCountInDocument для розрахунку собівартості
              const costForThisSale = defaultCostPerUnit * itemsCountInDocument;
              console.log(`[altegio/inventory] ✅ Sale document ${documentId}: default_cost_per_unit=${defaultCostPerUnit}, items=${itemsCountInDocument}, cost=${costForThisSale}`);
              return { cost: costForThisSale, amount: itemsCountInDocument, itemsCount: itemsCountInDocument };
            } else {
              // Навіть якщо не знайшли собівартість, повертаємо кількість позицій
              if (itemsCountInDocument > 0) {
                return { cost: 0, amount: itemsCountInDocument, itemsCount: itemsCountInDocument };
              }
              
              // Логуємо структуру документа для діагностики (тільки один раз для всього процесу)
              if (!hasLoggedDocumentStructure) {
                hasLoggedDocumentStructure = true;
                console.log(`[altegio/inventory] ⚠️ Sale document ${documentId}: default_cost_per_unit not found. Document structure:`, JSON.stringify(saleDocument, null, 2).substring(0, 1000));
              }
              return null;
            }
          } catch (err: any) {
            // Можливо, не всі транзакції мають відповідні sale documents
            // Або endpoint повертає 404 для деяких транзакцій
            console.log(`[altegio/inventory] ⚠️ Failed to fetch sale document ${documentId}:`, err?.message || String(err));
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter((result): result is { cost: number; amount: number; itemsCount: number } => 
          result !== null && typeof result === 'object' && 'itemsCount' in result
        );
        
        // Зберігаємо всі результати для підрахунку загальної кількості товарів
        // ВАЖЛИВО: зберігаємо навіть ті, де cost = 0, бо нам потрібна кількість товарів
        allSaleDocumentResults.push(...validResults);
        
        // Рахуємо собівартість тільки з результатів, де є cost > 0
        const resultsWithCost = validResults.filter(r => r.cost > 0);
        costFromSaleDocuments += resultsWithCost.reduce((sum, result) => sum + result.cost, 0);
        costItemsCount += resultsWithCost.reduce((sum, result) => sum + result.amount, 0);
        costTransactionsCount += resultsWithCost.length;
        
        // Для транзакцій, де не вдалося отримати документ, додаємо кількість з транзакції складу
        const failedDocuments = batch.filter((sale, idx) => batchResults[idx] === null);
        const itemsFromFailedDocuments = failedDocuments.reduce((sum, sale) => {
          const amount = Math.abs(Number(sale.amount) || 0);
          return sum + amount;
        }, 0);
        
        // Додаємо кількість товарів з невдалих документів до загальної суми
        if (itemsFromFailedDocuments > 0) {
          allSaleDocumentResults.push({ cost: 0, amount: itemsFromFailedDocuments, itemsCount: itemsFromFailedDocuments });
        }
        
        successfulFetches += validResults.length;
        failedFetches += batchResults.length - validResults.length;
        
        // Невелика затримка між пакетами для уникнення rate limiting
        if (i + batchSize < sales.length) {
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
      
      if (costFromSaleDocuments > 0) {
        calculatedCost = costFromSaleDocuments;
        console.log(`[altegio/inventory] ✅ Calculated cost from sale documents (default_cost_per_unit): ${calculatedCost} (transactions: ${costTransactionsCount}/${sales.length}, items: ${costItemsCount}, failed: ${failedFetches})`);
      } else {
        console.log(`[altegio/inventory] ⚠️ No cost found from sale documents (successful: ${successfulFetches}, failed: ${failedFetches})`);
      }
    } catch (err: any) {
      console.warn(`[altegio/inventory] ⚠️ Failed to fetch cost from sale documents:`, err?.message || String(err));
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

  // Використовуємо обчислену собівартість з API (пріоритет), інакше ручно введену, інакше 0
  const finalCost = calculatedCost !== null 
    ? calculatedCost 
    : (manualCost !== null ? manualCost : 0);
  
  if (calculatedCost !== null) {
    console.log(`[altegio/inventory] ✅ Using calculated cost from API: ${calculatedCost}`);
  } else if (manualCost !== null) {
    console.log(`[altegio/inventory] ⚠️ Using manual cost (fallback): ${manualCost}`);
  } else {
    console.log(`[altegio/inventory] ⚠️ No cost found (calculated or manual), using 0. Please check API settings.`);
  }

  // Розраховуємо націнку як revenue - cost
  const profit = revenue - finalCost;
  console.log(
    `[altegio/inventory] Profit = revenue - cost: ${profit} (revenue: ${revenue}, cost: ${finalCost})`,
  );

  // Конвертуємо мапу товарів у масив та сортуємо за назвою
  const goodsList = Array.from(goodsMap.values())
    .sort((a, b) => a.title.localeCompare(b.title, 'uk-UA'));
  
  console.log(`[altegio/inventory] 📦 Collected ${goodsList.length} unique goods from sale documents`);
  
  return {
    range: { date_from, date_to },
    revenue,
    cost: finalCost,
    profit,
    itemsCount: sales.length,
    totalItemsSold,
    costItemsCount: costItemsCount > 0 ? costItemsCount : undefined,
    costTransactionsCount: costTransactionsCount > 0 ? costTransactionsCount : undefined,
    goodsList: goodsList.length > 0 ? goodsList : undefined,
  };
}

