// web/lib/altegio/inventory.ts
// Транзакції по товарах (inventory) + агрегована виручка по товарах за період

import { ALTEGIO_ENV } from "./env";
import { altegioFetch } from "./client";

// Тип для Product sales report (sales_analysis endpoint)
export type AltegioProductSalesItem = {
  id?: number;
  good_id?: number;
  good?: {
    id: number;
    title: string;
  };
  quantity?: number; // кількість проданих одиниць
  unit_cost?: number; // Unit cost (Wholesale) - закупівельна ціна за одиницю
  markup?: number; // націнка в грошах
  markup_percent?: number; // націнка у відсотках
  total_cost?: number; // Total cost - виручка по товару
  [key: string]: any; // для додаткових полів
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
 * Отримати агреговану виручку / собівартість / націнку по товарах із Product sales report за період.
 *
 * Використовуємо `/storages/sales_analysis/{companyId}`, який відповідає Product sales report у веб-інтерфейсі.
 *
 * Поля з Product sales report:
 * - `total_cost` = виручка по товару (Total cost / Виручка)
 * - `unit_cost` = закупівельна ціна за одиницю (Unit cost (Wholesale) / Собівартість)
 * - `markup` = націнка в грошах (Markup / Дохід)
 * - `quantity` = кількість проданих одиниць
 *
 * Тоді:
 *   revenue = Σ total_cost
 *   cost    = Σ (unit_cost * quantity) або Σ unit_cost (якщо вже агреговано)
 *   profit  = Σ markup або revenue - cost
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
    category_id: "0", // всі категорії
    employee_id: "0", // всі співробітники
    supplier_id: "-1", // всі постачальники
    is_categories: "1", // групуючи по категоріях
  });

  const path = `/storages/sales_analysis/${companyId}?${qs.toString()}`;

  const raw = await altegioFetch<any>(path);

  // Логуємо структуру відповіді для діагностики
  console.log(
    `[altegio/inventory] sales_analysis response structure:`,
    JSON.stringify(
      {
        isArray: Array.isArray(raw),
        hasData: raw && typeof raw === "object" && "data" in raw,
        sampleKeys: raw && typeof raw === "object" ? Object.keys(raw).slice(0, 10) : [],
        firstItem:
          Array.isArray(raw) && raw.length > 0
            ? Object.keys(raw[0]).slice(0, 15)
            : raw && typeof raw === "object" && Array.isArray((raw as any).data) && (raw as any).data.length > 0
              ? Object.keys((raw as any).data[0]).slice(0, 15)
              : [],
      },
      null,
      2,
    ),
  );

  // Розпаковуємо дані (може бути масив або об'єкт з data)
  const items: AltegioProductSalesItem[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : [];

  // Логуємо перший елемент для перевірки полів
  if (items.length > 0) {
    console.log(
      `[altegio/inventory] Sample sales_analysis item:`,
      JSON.stringify(
        {
          ...items[0],
          allKeys: Object.keys(items[0]),
        },
        null,
        2,
      ),
    );
  }

  // Агрегуємо дані
  const revenue = items.reduce(
    (sum, item) => sum + (Number(item.total_cost) || 0),
    0,
  );

  // Собівартість: або з unit_cost * quantity, або з окремого поля
  const cost = items.reduce(
    (sum, item) => {
      const unitCost = Number(item.unit_cost) || 0;
      const quantity = Number(item.quantity) || 0;
      // Якщо є quantity, множимо; якщо ні, беремо unit_cost як вже помножене значення
      return sum + (quantity > 0 ? unitCost * quantity : unitCost);
    },
    0,
  );

  // Націнка: або з поля markup, або revenue - cost
  const profitFromMarkup = items.reduce(
    (sum, item) => sum + (Number(item.markup) || 0),
    0,
  );
  const profit = profitFromMarkup > 0 ? profitFromMarkup : revenue - cost;

  return {
    range: { date_from, date_to },
    revenue,
    cost,
    profit,
    itemsCount: items.length,
  };
}

