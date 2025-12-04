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


/** Агрегована інформація по продажах товарів за період */
export type GoodsSalesSummary = {
  range: { date_from: string; date_to: string };
  revenue: number; // Виручка з транзакцій (може бути нижча за реальну)
  cost: number; // Собівартість (ручно введене значення з KV або 0)
  profit: number; // Націнка (revenue - cost)
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

  // Спробуємо обчислити собівартість з різних джерел
  let calculatedCost: number | null = null;
  
  // Варіант 1: З транзакцій закупки (type_id=2)
  // Можливо, cost_per_unit або cost в транзакціях закупки містить собівартість
  if (purchases.length > 0) {
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
    const possibleCostFields = Object.keys(sampleSale).filter(key => 
      key.toLowerCase().includes('wholesale') || 
      key.toLowerCase().includes('purchase') ||
      key.toLowerCase().includes('buy') ||
      (key.toLowerCase().includes('cost') && !key.toLowerCase().includes('per'))
    );
    
    if (possibleCostFields.length > 0) {
      console.log(`[altegio/inventory] Found possible cost fields in sales:`, possibleCostFields);
      // Спробуємо обчислити собівартість з цих полів
      const costFromSales = sales.reduce((sum, t) => {
        for (const field of possibleCostFields) {
          const value = Number((t as any)[field]) || 0;
          if (value > 0) {
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
    
    // Якщо не знайшли окремі поля, спробуємо використати cost_per_unit як собівартість
    // (якщо в налаштуваннях API cost_per_unit тепер містить оптову ціну)
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

  // Використовуємо обчислену собівартість, якщо вона є, інакше ручно введену, інакше 0
  const finalCost = calculatedCost !== null 
    ? calculatedCost 
    : (manualCost !== null ? manualCost : 0);
  
  if (calculatedCost !== null) {
    console.log(`[altegio/inventory] ✅ Using calculated cost from API: ${calculatedCost}`);
  } else if (manualCost !== null) {
    console.log(`[altegio/inventory] Using manual cost: ${manualCost}`);
  } else {
    console.log(`[altegio/inventory] ⚠️ No cost found (calculated or manual), using 0. Please set cost manually or check API settings.`);
  }
  
  if (manualCost !== null) {
    console.log(
      `[altegio/inventory] Using manual cost: ${manualCost}`,
    );
  } else {
    console.log(
      `[altegio/inventory] No manual cost set, using 0. Please set cost manually.`,
    );
  }

  // Розраховуємо націнку як revenue - cost
  const profit = revenue - finalCost;
  console.log(
    `[altegio/inventory] Profit = revenue - cost: ${profit} (revenue: ${revenue}, cost: ${finalCost})`,
  );

  return {
    range: { date_from, date_to },
    revenue,
    cost: finalCost,
    profit,
    itemsCount: sales.length,
  };
}


