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

export type AltegioExpenseCategory = {
  id: number;
  name?: string;
  title?: string;
  category?: string;
  [key: string]: any;
};

export type ExpensesSummary = {
  range: { date_from: string; date_to: string };
  total: number;
  byCategory: Record<string, number>; // Категорія -> сума
  transactions: AltegioFinanceTransaction[];
  categories?: AltegioExpenseCategory[]; // Список доступних категорій
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
 * Отримати список категорій витрат з Altegio API
 * Використовує endpoint: GET /expenses/{company_id}
 */
export async function fetchExpenseCategories(): Promise<AltegioExpenseCategory[]> {
  const companyId = resolveCompanyId();

  const attempts = [
    `/expenses/${companyId}`,
    `/company/${companyId}/expenses`,
    `/expenses?company_id=${companyId}`,
  ];

  for (const path of attempts) {
    try {
      console.log(`[altegio/expenses] Fetching categories: ${path}`);
      const raw = await altegioFetch<any>(path);

      const categories: AltegioExpenseCategory[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as any).data)
          ? (raw as any).data
          : raw && typeof raw === "object" && Array.isArray((raw as any).expenses)
            ? (raw as any).expenses
            : [];

      if (categories.length > 0) {
        console.log(
          `[altegio/expenses] ✅ Got ${categories.length} expense categories using ${path}`,
        );
        return categories;
      }
    } catch (err: any) {
      console.warn(
        `[altegio/expenses] Failed to fetch categories from ${path}:`,
        err?.message || String(err),
      );
      continue;
    }
  }

  console.warn(`[altegio/expenses] ⚠️ No expense categories found`);
  return [];
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

  // Спочатку отримуємо список категорій витрат
  const categories = await fetchExpenseCategories();

  // Створюємо мапу category_id -> category_name для швидкого пошуку
  const categoryMap = new Map<number, string>();
  for (const cat of categories) {
    const name = cat.name || cat.title || cat.category || `Категорія ${cat.id}`;
    categoryMap.set(cat.id, name);
  }

  // Спробуємо різні варіанти параметрів для finance_transactions
  const attempts = [
    {
      name: "with expense_id filter",
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        real_money: "true",
        deleted: "false",
      }),
    },
    {
      name: "with type=expense",
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        type: "expense",
        real_money: "true",
        deleted: "false",
      }),
    },
    {
      name: "basic date filter",
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
      }),
    },
  ];

  let transactions: AltegioFinanceTransaction[] = [];
  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const path = `/finance_transactions/${companyId}?${attempt.params.toString()}`;
      console.log(`[altegio/expenses] Trying ${attempt.name}: ${path}`);

      const raw = await altegioFetch<any>(path);

      // Розпаковуємо дані (може бути масив або об'єкт з data)
      const fetched: AltegioFinanceTransaction[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as any).data)
          ? (raw as any).data
          : raw && typeof raw === "object" && Array.isArray((raw as any).transactions)
            ? (raw as any).transactions
            : [];

      if (fetched.length > 0) {
        transactions = fetched;
        console.log(
          `[altegio/expenses] ✅ Got ${transactions.length} transactions using ${attempt.name}`,
        );
        break;
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[altegio/expenses] Failed with ${attempt.name}:`,
        lastError.message,
      );
      continue;
    }
  }

  if (transactions.length === 0 && lastError) {
    console.error(
      `[altegio/expenses] ❌ All attempts failed, last error:`,
      lastError,
    );
  }

  try {

    // Розпаковуємо дані (може бути масив або об'єкт з data)
    const transactions: AltegioFinanceTransaction[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as any).data)
        ? (raw as any).data
        : raw && typeof raw === "object" && Array.isArray((raw as any).transactions)
          ? (raw as any).transactions
          : [];

    console.log(
      `[altegio/expenses] Processing ${transactions.length} finance transactions`,
    );

    // Фільтруємо тільки витрати (expenses)
    // Витрати мають type="expense" або від'ємний amount, або expense_id
    const expenses = transactions.filter((t) => {
      const amount = toNumber(t.amount);
      const hasExpenseId = !!t.expense_id;
      const isExpenseType =
        t.type === "expense" ||
        t.type === "outcome" ||
        (t.type && String(t.type).toLowerCase().includes("expense"));
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
      // Спочатку шукаємо в мапі категорій за expense_id
      let categoryName = "Інші витрати";
      
      if (expense.expense_id && categoryMap.has(expense.expense_id)) {
        categoryName = categoryMap.get(expense.expense_id)!;
      } else if (expense.expense?.name) {
        categoryName = expense.expense.name;
      } else if (expense.expense?.category) {
        categoryName = expense.expense.category;
      } else if (expense.expense?.title) {
        categoryName = expense.expense.title;
      } else if (expense.comment) {
        categoryName = expense.comment;
      }

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
      categories,
    };
  } catch (error: any) {
    console.error(`[altegio/expenses] Failed to fetch expenses:`, error);
    // Повертаємо порожній результат замість помилки
    return {
      range: { date_from, date_to },
      total: 0,
      byCategory: {},
      transactions: [],
      categories: [],
    };
  }
}
