// web/lib/altegio/inventory.ts
// Транзакції по товарах (inventory) + агрегована виручка по товарах за період

import { ALTEGIO_ENV } from "./env";
import { altegioFetch } from "./client";

// Мінімальний тип транзакції складу, який нам потрібен для звіту
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
 * Отримати агреговану виручку / собівартість / націнку по товарах із inventory за період.
 *
 * Припущення (перевірене на Product sales report):
 * - `cost` у транзакції продажу = виручка по товару (Total cost у звіті)
 * - `cost_per_unit` = закупівельна ціна за одиницю (Unit cost (Wholesale))
 * - `amount` = кількість проданих одиниць
 *
 * Тоді:
 *   revenue = Σ cost
 *   cost    = Σ (cost_per_unit * amount)
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

  // /storages/transactions повертає { success, data: Transaction[], meta: {...} }
  const tx: AltegioStorageTransaction[] = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as any).data)
        ? (raw as any).data
        : []);

  // type_id = 1 — продаж товарів (Sale of goods)
  const sales = tx.filter((t) => Number(t.type_id) === 1);

  const revenue = sales.reduce(
    (sum, t) => sum + (Number(t.cost) || 0),
    0,
  );

  const cost = sales.reduce(
    (sum, t) =>
      sum +
      (Number(t.cost_per_unit) || 0) * (Number(t.amount) || 0),
    0,
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

