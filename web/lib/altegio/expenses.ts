// web/lib/altegio/expenses.ts
// Витрати (expenses) з Altegio API

import { altegioFetch } from "./client";
import { ALTEGIO_ENV } from "./env";

export type AltegioFinanceTransaction = {
  id: number;
  document_id?: number;
  expense_id?: number;
  expense?: {
    id: number;
    name?: string;
    category?: string;
  };
  account_id?: number;
  account?: {
    id: number;
    name?: string;
  };
  amount: number | string;
  date: string;
  type?: string; // "expense" | "income" | etc.
  comment?: string;
  master_id?: number;
  supplier_id?: number;
  client_id?: number;
  real_money?: boolean;
  deleted?: boolean;
  [key: string]: any;
};

export type ExpensesSummary = {
  range: { date_from: string; date_to: string };
  total: number;
  byCategory: Record<string, number>; // Категорія -> сума
  transactions: AltegioFinanceTransaction[];
};

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;

  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error(
      "ALTEGIO_COMPANY_ID is required to fetch expenses (optionally can fall back to ALTEGIO_PARTNER_ID / ALTEGIO_APPLICATION_ID)",
    );
  }
  return companyId;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Отримати витрати за період з Altegio API
 * Використовує endpoint: GET /finance_transactions/{company_id}
 */
export async function fetchExpensesSummary(params: {
  date_from: string;
  date_to: string;
}): Promise<ExpensesSummary> {
  const { date_from, date_to } = params;
  const companyId = resolveCompanyId();

  const qs = new URLSearchParams({
    start_date: date_from,
    end_date: date_to,
    // Фільтруємо тільки витрати (expenses), не доходи
    // type може бути "expense" або інші значення
    // real_money=true - тільки реальні гроші (не резерви)
    real_money: "true",
    deleted: "false",
  });

  const path = `/finance_transactions/${companyId}?${qs.toString()}`;

  console.log(`[altegio/expenses] Fetching expenses: ${path}`);

  try {
    const raw = await altegioFetch<any>(path);

    // Розпаковуємо дані (може бути масив або об'єкт з data)
    const transactions: AltegioFinanceTransaction[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as any).data)
        ? (raw as any).data
        : raw && typeof raw === "object" && Array.isArray((raw as any).transactions)
          ? (raw as any).transactions
          : [];

    console.log(
      `[altegio/expenses] Fetched ${transactions.length} finance transactions`,
    );

    // Фільтруємо тільки витрати (expenses)
    // Витрати мають type="expense" або від'ємний amount, або expense_id
    const expenses = transactions.filter((t) => {
      const amount = toNumber(t.amount);
      const hasExpenseId = !!t.expense_id;
      const isExpenseType = t.type === "expense" || t.type === "outcome";
      // Якщо є expense_id або type=expense, це витрата
      // Або якщо amount від'ємний (для деяких систем)
      return hasExpenseId || isExpenseType || amount < 0;
    });

    console.log(
      `[altegio/expenses] Filtered expenses: ${expenses.length} items`,
    );

    // Групуємо по категоріях (expense.name або expense.category)
    const byCategory: Record<string, number> = {};
    let total = 0;

    for (const expense of expenses) {
      const amount = Math.abs(toNumber(expense.amount)); // Беремо абсолютне значення
      total += amount;

      // Визначаємо категорію
      const categoryName =
        expense.expense?.name ||
        expense.expense?.category ||
        expense.comment ||
        "Інші витрати";

      byCategory[categoryName] = (byCategory[categoryName] || 0) + amount;
    }

    console.log(
      `[altegio/expenses] Total expenses: ${total}, Categories: ${Object.keys(byCategory).length}`,
    );

    return {
      range: { date_from, date_to },
      total,
      byCategory,
      transactions: expenses,
    };
  } catch (error: any) {
    console.error(`[altegio/expenses] Failed to fetch expenses:`, error);
    // Повертаємо порожній результат замість помилки
    return {
      range: { date_from, date_to },
      total: 0,
      byCategory: {},
      transactions: [],
    };
  }
}
