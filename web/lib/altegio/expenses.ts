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
 * Спробуємо різні endpoint'и згідно з документацією
 */
export async function fetchExpenseCategories(): Promise<AltegioExpenseCategory[]> {
  const companyId = resolveCompanyId();

  const attempts = [
    `/expenses`, // Згідно з документацією: GET /expenses
    `/expenses/${companyId}`,
    `/company/${companyId}/expenses`,
    `/expenses?company_id=${companyId}`,
    `/company/${companyId}/expense_categories`,
    `/expense_categories/${companyId}`,
    `/expense_categories?company_id=${companyId}`,
  ];

  for (const path of attempts) {
    try {
      console.log(`[altegio/expenses] 🔍 Fetching categories: ${path}`);
      const raw = await altegioFetch<any>(path);

      console.log(`[altegio/expenses] Raw response type:`, typeof raw);
      console.log(`[altegio/expenses] Raw response keys:`, raw && typeof raw === "object" ? Object.keys(raw) : "not an object");

      // Різні формати відповіді
      let categories: AltegioExpenseCategory[] = [];
      
      if (Array.isArray(raw)) {
        categories = raw;
      } else if (raw && typeof raw === "object") {
        // Спробуємо різні поля
        if (Array.isArray((raw as any).data)) {
          categories = (raw as any).data;
        } else if (Array.isArray((raw as any).expenses)) {
          categories = (raw as any).expenses;
        } else if (Array.isArray((raw as any).categories)) {
          categories = (raw as any).categories;
        } else if (Array.isArray((raw as any).items)) {
          categories = (raw as any).items;
        } else if ((raw as any).success && Array.isArray((raw as any).data)) {
          categories = (raw as any).data;
        }
      }

      if (categories.length > 0) {
        console.log(
          `[altegio/expenses] ✅ Got ${categories.length} expense categories using ${path}`,
        );
        console.log(`[altegio/expenses] Sample category:`, categories[0]);
        return categories;
      } else {
        console.log(`[altegio/expenses] ⚠️ No categories found in response from ${path}`);
      }
    } catch (err: any) {
      console.warn(
        `[altegio/expenses] ❌ Failed to fetch categories from ${path}:`,
        err?.message || String(err),
      );
      continue;
    }
  }

  console.warn(`[altegio/expenses] ⚠️ No expense categories found from any endpoint`);
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

  // Спробуємо різні варіанти endpoint'ів та параметрів для finance_transactions
  const attempts = [
    {
      name: "GET /finance_transactions/{id} with date_from/date_to",
      path: `/finance_transactions/${companyId}`,
      params: new URLSearchParams({
        date_from: date_from,
        date_to: date_to,
        real_money: "true",
        deleted: "false",
      }),
    },
    {
      name: "GET /finance_transactions/{id} with start_date/end_date",
      path: `/finance_transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        real_money: "true",
        deleted: "false",
      }),
    },
    {
      name: "GET /finance_transactions/{id} with type=expense",
      path: `/finance_transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        type: "expense",
        real_money: "true",
        deleted: "false",
      }),
    },
    {
      name: "GET /company/{id}/finance_transactions",
      path: `/company/${companyId}/finance_transactions`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
      }),
    },
    {
      name: "GET /finance_transactions/{id} basic",
      path: `/finance_transactions/${companyId}`,
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
      const fullPath = `${attempt.path}?${attempt.params.toString()}`;
      console.log(`[altegio/expenses] 🔍 Trying ${attempt.name}: ${fullPath}`);

      const raw = await altegioFetch<any>(fullPath);
      
      console.log(`[altegio/expenses] Response type:`, typeof raw);
      console.log(`[altegio/expenses] Response is array:`, Array.isArray(raw));
      if (raw && typeof raw === "object") {
        console.log(`[altegio/expenses] Response keys:`, Object.keys(raw));
      }

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

  if (transactions.length === 0) {
    if (lastError) {
      console.error(
        `[altegio/expenses] ❌ All attempts failed, last error:`,
        lastError,
      );
    } else {
      console.warn(
        `[altegio/expenses] ⚠️ No transactions found, but no errors occurred`,
      );
    }
    
    // Повертаємо порожній результат, але з категоріями (якщо вони є)
    return {
      range: { date_from, date_to },
      total: 0,
      byCategory: {},
      transactions: [],
      categories,
    };
  }

  console.log(
    `[altegio/expenses] Processing ${transactions.length} finance transactions`,
  );

  // Фільтруємо тільки витрати (expenses)
  // Витрати мають type="expense" або від'ємний amount, або expense_id
  // Але спочатку логуємо всі транзакції для діагностики
  if (transactions.length > 0) {
    console.log(`[altegio/expenses] Sample transaction:`, transactions[0]);
  }
  
  const expenses = transactions.filter((t) => {
    const amount = toNumber(t.amount);
    const hasExpenseId = !!t.expense_id;
    const isExpenseType =
      t.type === "expense" ||
      t.type === "outcome" ||
      (t.type && String(t.type).toLowerCase().includes("expense"));
    
    // Логуємо перші кілька транзакцій для діагностики
    if (transactions.indexOf(t) < 3) {
      console.log(`[altegio/expenses] Transaction ${t.id}:`, {
        expense_id: t.expense_id,
        type: t.type,
        amount: t.amount,
        hasExpenseId,
        isExpenseType,
        willInclude: hasExpenseId || isExpenseType || amount < 0,
      });
    }
    
    // Якщо є expense_id або type=expense, це витрата
    // Або якщо amount від'ємний (для деяких систем)
    // АБО якщо немає явного type="income" - спробуємо включити
    const isIncome = t.type === "income" || t.type === "incoming";
    return !isIncome && (hasExpenseId || isExpenseType || amount < 0 || (!t.type && hasExpenseId));
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
}
