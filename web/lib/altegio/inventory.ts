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
    
    // Динамічний імпорт для уникнення проблем з server components
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const rawValue = await kvReadModule.getRaw(costKey);
      if (rawValue !== null && typeof rawValue === "string") {
        // Парсимо JSON, якщо це JSON, інакше пробуємо як число
        let costValue: number | null = null;
        try {
          const parsed = JSON.parse(rawValue);
          costValue = typeof parsed === "number" ? parsed : parseFloat(String(parsed));
        } catch {
          // Якщо не JSON, пробуємо як число
          costValue = parseFloat(rawValue);
        }
        
        if (costValue !== null && Number.isFinite(costValue) && costValue >= 0) {
          manualCost = costValue;
          console.log(
            `[altegio/inventory] Using manual cost for ${year}-${month}: ${manualCost}`,
          );
        }
      }
    }
  } catch (err: any) {
    // Ігноруємо помилки читання KV - просто не використовуємо ручну собівартість
    // Це не критична помилка, тому продовжуємо роботу
    console.warn(
      `[altegio/inventory] Failed to check manual cost (non-critical):`,
      err?.message || String(err),
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

  // type_id = 1 — продаж товарів (Sale of goods)
  // Беремо всі транзакції типу 1 (продажі), включаючи повернення
  const sales = tx.filter((t) => Number(t.type_id) === 1);

  console.log(
    `[altegio/inventory] filtered sales (type_id=1): ${sales.length} items`,
  );

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

  // Використовуємо ручно введену собівартість, якщо вона є, інакше 0
  const finalCost = manualCost !== null ? manualCost : 0;
  
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

