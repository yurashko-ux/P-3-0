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
    title?: string;
    category?: string;
    [key: string]: any;
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
/**
 * Отримати ручні витрати з KV (якщо API не працює)
 */
async function getManualExpenses(year: number, month: number): Promise<number | null> {
  try {
    const expensesKey = `finance:expenses:${year}:${month}`;
    console.log(`[altegio/expenses] Checking for manual expenses: key=${expensesKey}, year=${year}, month=${month}`);
    
    // Динамічний імпорт для уникнення проблем з server components
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const rawValue = await kvReadModule.getRaw(expensesKey);
      console.log(`[altegio/expenses] KV read result for ${expensesKey}:`, {
        hasValue: rawValue !== null,
        valueType: typeof rawValue,
        valuePreview: rawValue ? String(rawValue).slice(0, 100) : null,
      });
      
      if (rawValue !== null && typeof rawValue === "string") {
        let expensesValue: number | null = null;
        try {
          const parsed = JSON.parse(rawValue);
          console.log(`[altegio/expenses] Parsed JSON:`, { parsed, type: typeof parsed });
          
          if (typeof parsed === "number") {
            expensesValue = parsed;
          } else if (typeof parsed === "object" && parsed !== null) {
            const value = (parsed as any).value ?? parsed;
            if (typeof value === "number") {
              expensesValue = value;
            } else if (typeof value === "string") {
              expensesValue = parseFloat(value);
            } else {
              expensesValue = parseFloat(String(value));
            }
          } else if (typeof parsed === "string") {
            expensesValue = parseFloat(parsed);
          } else {
            expensesValue = parseFloat(String(parsed));
          }
        } catch {
          expensesValue = parseFloat(rawValue);
        }
        
        if (expensesValue !== null && Number.isFinite(expensesValue) && expensesValue >= 0) {
          console.log(`[altegio/expenses] ✅ Using manual expenses for ${year}-${month}: ${expensesValue}`);
          return expensesValue;
        }
      }
    }
  } catch (err: any) {
    console.error(`[altegio/expenses] ❌ Failed to check manual expenses:`, err?.message || String(err));
  }
  return null;
}

export async function fetchExpensesSummary(params: {
  date_from: string;
  date_to: string;
}): Promise<ExpensesSummary> {
  const { date_from, date_to } = params;
  const companyId = resolveCompanyId();

  // Перевіряємо ручні витрати
  const dateFrom = new Date(date_from);
  const year = dateFrom.getFullYear();
  const month = dateFrom.getMonth() + 1;
  const manualExpenses = await getManualExpenses(year, month);

  // Спробуємо отримати список категорій витрат (опціонально, якщо endpoint доступний)
  // Якщо не вдається - використаємо дані з транзакцій
  let categories: AltegioExpenseCategory[] = [];
  const categoryMap = new Map<number, string>();
  
  try {
    categories = await fetchExpenseCategories();
    // Створюємо мапу category_id -> category_name для швидкого пошуку
    for (const cat of categories) {
      const name = cat.name || cat.title || cat.category || `Категорія ${cat.id}`;
      categoryMap.set(cat.id, name);
      
      // Діагностика: шукаємо категорію "Комісія за еквайринг"
      const catNameLower = name.toLowerCase();
      if (catNameLower.includes("еквайринг") || catNameLower.includes("acquiring") || 
          catNameLower.includes("комісія") || catNameLower.includes("комиссия")) {
        console.log(`[altegio/expenses] 🔍 Found acquiring-related category:`, {
          id: cat.id,
          name: cat.name,
          title: cat.title,
          category: cat.category,
          normalized_name: name,
          full_object: cat,
        });
      }
    }
    console.log(`[altegio/expenses] 📋 Loaded ${categoryMap.size} expense categories from API`);
  } catch (err) {
    console.log(`[altegio/expenses] ⚠️ Could not fetch categories, will extract from transactions`);
  }

  // Згідно з Payments API та структурою інших endpoint'ів
  // Спробуємо різні варіанти endpoint'ів, включаючи location_id (як у appointments)
  // ПРІОРИТЕТ: POST /company/{id}/finance_transactions/search - може повертати ВСІ фінансові операції
  const attempts: Array<{
    name: string;
    method: "GET" | "POST";
    path: string;
    params?: URLSearchParams;
    body?: any;
  }> = [
    // Варіант 0 (найперспективніший): POST /company/{id}/finance_transactions/search БЕЗ ЖОДНИХ ФІЛЬТРІВ
    // Витягуємо ВСІ транзакції як є, без фільтрів
    {
      name: "POST /company/{id}/finance_transactions/search (NO FILTERS)",
      method: "POST",
      path: `/company/${companyId}/finance_transactions/search`,
      body: {
        start_date: date_from,
        end_date: date_to,
        count: 10000,
        page: 1,
      },
    },
    // Варіант 0.1: POST /company/{id}/finance_transactions/search з мінімальними фільтрами
    {
      name: "POST /company/{id}/finance_transactions/search (minimal filters)",
      method: "POST",
      path: `/company/${companyId}/finance_transactions/search`,
      body: {
        start_date: date_from,
        end_date: date_to,
        deleted: false,
        count: 10000,
        page: 1,
      },
    },
    // Варіант 0.2: GET /transactions/{location_id} БЕЗ ЖОДНИХ ФІЛЬТРІВ
    {
      name: "GET /transactions/{location_id} (NO FILTERS)",
      method: "GET",
      path: `/transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        count: "10000",
      }),
    },
    // Варіант 0.3: GET /transactions/{location_id} з мінімальними фільтрами
    {
      name: "GET /transactions/{location_id} (minimal filters)",
      method: "GET",
      path: `/transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        deleted: "0",
        count: "10000",
      }),
    },
    // Варіант 0.4: GET /finance_transactions/{location_id} БЕЗ ЖОДНИХ ФІЛЬТРІВ
    {
      name: "GET /finance_transactions/{location_id} (NO FILTERS)",
      method: "GET",
      path: `/finance_transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        count: "10000",
      }),
    },
    // Варіант 0.5: GET /finance_transactions/{location_id} з мінімальними фільтрами
    {
      name: "GET /finance_transactions/{location_id} (minimal filters)",
      method: "GET",
      path: `/finance_transactions/${companyId}`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        deleted: "0",
        count: "10000",
      }),
    },
    // Варіант 0.1: GET /transactions/{location_id} з date_from/date_to
    {
      name: "GET /transactions/{location_id} (date_from/date_to)",
      method: "GET",
      path: `/transactions/${companyId}`,
      params: new URLSearchParams({
        date_from: date_from,
        date_to: date_to,
        real_money: "1",
        deleted: "0",
        count: "1000",
      }),
    },
    // Варіант 1: /company/{id}/analytics/expenses (можливо є в analytics)
    {
      name: "GET /company/{id}/analytics/expenses",
      method: "GET",
      path: `/company/${companyId}/analytics/expenses`,
      params: new URLSearchParams({
        date_from: date_from,
        date_to: date_to,
      }),
    },
    // Варіант 2: /company/{id}/analytics/overall (можливо містить витрати)
    {
      name: "GET /company/{id}/analytics/overall (check for expenses)",
      method: "GET",
      path: `/company/${companyId}/analytics/overall`,
      params: new URLSearchParams({
        date_from: date_from,
        date_to: date_to,
      }),
    },
    // Варіант 3: /finance_transactions з location_id (як у appointments)
    {
      name: "GET /finance_transactions with location_id",
      method: "GET",
      path: `/finance_transactions`,
      params: new URLSearchParams({
        location_id: companyId,
        start_date: date_from,
        end_date: date_to,
        real_money: "1",
        deleted: "0",
        count: "1000",
      }),
    },
    {
      name: "GET /finance_transactions with location_id (date_from/date_to)",
      method: "GET",
      path: `/finance_transactions`,
      params: new URLSearchParams({
        location_id: companyId,
        date_from: date_from,
        date_to: date_to,
        real_money: "1",
        deleted: "0",
        count: "1000",
      }),
    },
    // Варіант 4: /company/{id}/finance_transactions
    {
      name: "GET /company/{id}/finance_transactions with start_date/end_date",
      method: "GET",
      path: `/company/${companyId}/finance_transactions`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        real_money: "1",
        deleted: "0",
        count: "1000",
      }),
    },
    {
      name: "GET /company/{id}/finance_transactions with date_from/date_to",
      method: "GET",
      path: `/company/${companyId}/finance_transactions`,
      params: new URLSearchParams({
        date_from: date_from,
        date_to: date_to,
        real_money: "1",
        deleted: "0",
        count: "1000",
      }),
    },
    // Варіант 5: POST /company/{id}/finance_transactions/search
    {
      name: "POST /company/{id}/finance_transactions/search",
      method: "POST",
      path: `/company/${companyId}/finance_transactions/search`,
      body: {
        start_date: date_from,
        end_date: date_to,
        real_money: true,
        deleted: false,
        count: 1000,
      },
    },
    // Варіант 6: /company/{id}/payments
    {
      name: "GET /company/{id}/payments",
      method: "GET",
      path: `/company/${companyId}/payments`,
      params: new URLSearchParams({
        start_date: date_from,
        end_date: date_to,
        count: "1000",
      }),
    },
    // Варіант 7: /finance_transactions/{id} (fallback)
    {
      name: "GET /finance_transactions/{id} (fallback)",
      method: "GET",
      path: `/finance_transactions/${companyId}`,
      params: new URLSearchParams({
        date_from: date_from,
        date_to: date_to,
        count: "1000",
      }),
    },
  ];

  let transactions: AltegioFinanceTransaction[] = [];
  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      let fullPath = attempt.path;
      if (attempt.params) {
        fullPath = `${attempt.path}?${attempt.params.toString()}`;
      }
      console.log(`[altegio/expenses] 🔍 Trying ${attempt.name}: ${fullPath} (${attempt.method})`);

      const raw = await altegioFetch<any>(
        attempt.method === "POST" ? attempt.path : fullPath,
        attempt.method === "POST"
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attempt.body || {}),
            }
          : {}
      );
      
      console.log(`[altegio/expenses] Response type:`, typeof raw);
      console.log(`[altegio/expenses] Response is array:`, Array.isArray(raw));
      if (raw && typeof raw === "object") {
        console.log(`[altegio/expenses] Response keys:`, Object.keys(raw));
        // Для Payments API (/transactions) та Financial Operations API (/finance_transactions) логуємо детальніше структуру
        if (attempt.path.includes("/transactions/") || attempt.path.includes("/finance_transactions/")) {
          const data = (raw as any).data || raw;
          console.log(`[altegio/expenses] ${attempt.path.includes("/finance_transactions/") ? "Financial Operations" : "Payments"} API response structure:`, {
            hasSuccess: !!(raw as any).success,
            hasData: Array.isArray((raw as any).data),
            dataLength: Array.isArray((raw as any).data) ? (raw as any).data.length : 0,
            hasMeta: !!(raw as any).meta,
            sampleTransaction: Array.isArray((raw as any).data) && (raw as any).data.length > 0 
              ? JSON.stringify((raw as any).data[0], null, 2).substring(0, 1000)
              : null,
          });
          // Логуємо перші кілька транзакцій для діагностики
          if (Array.isArray((raw as any).data) && (raw as any).data.length > 0) {
            const sample = (raw as any).data[0];
            console.log(`[altegio/expenses] Sample ${attempt.path.includes("/finance_transactions/") ? "Financial Operations" : "Payments"} transaction:`, {
              id: sample.id,
              expense_id: sample.expense_id,
              expense: sample.expense,
              amount: sample.amount,
              type: sample.type,
              type_id: sample.type_id,
              date: sample.date,
              comment: sample.comment,
              allKeys: Object.keys(sample),
            });
          }
        }
        // Для analytics/overall логуємо детальніше структуру
        else if (attempt.path.includes("analytics/overall")) {
          const data = (raw as any).data || raw;
          console.log(`[altegio/expenses] Analytics overall data keys:`, data && typeof data === "object" ? Object.keys(data) : "not an object");
          // Шукаємо поля, що можуть містити витрати
          const possibleExpenseKeys = Object.keys(data || {}).filter(key => 
            key.toLowerCase().includes("expense") || 
            key.toLowerCase().includes("outcome") ||
            key.toLowerCase().includes("cost") ||
            key.toLowerCase().includes("spending")
          );
          if (possibleExpenseKeys.length > 0) {
            console.log(`[altegio/expenses] Found possible expense keys:`, possibleExpenseKeys);
            possibleExpenseKeys.forEach(key => {
              console.log(`[altegio/expenses] ${key}:`, JSON.stringify(data[key], null, 2).substring(0, 500));
            });
          }
        }
      }

      // Згідно з Payments API, відповідь має формат: { success: true, data: [...], meta: [...] }
      // Але також можуть бути analytics дані з expenses полем
      let fetched: AltegioFinanceTransaction[] = [];
      
      if (Array.isArray(raw)) {
        fetched = raw;
      } else if (raw && typeof raw === "object") {
        // Стандартний формат Altegio API
        if (Array.isArray((raw as any).data)) {
          fetched = (raw as any).data;
        } else if (Array.isArray((raw as any).transactions)) {
          fetched = (raw as any).transactions;
        } else if ((raw as any).success && Array.isArray((raw as any).data)) {
          fetched = (raw as any).data;
        }
        // Можливо, це analytics response з expenses
        else if ((raw as any).expenses && Array.isArray((raw as any).expenses)) {
          fetched = (raw as any).expenses;
        }
        // Або expenses в totals
        else if ((raw as any).totals && (raw as any).totals.expenses && Array.isArray((raw as any).totals.expenses)) {
          fetched = (raw as any).totals.expenses;
        }
        // Або це об'єкт з expenses полем
        else if ((raw as any).expenses_data && Array.isArray((raw as any).expenses_data)) {
          fetched = (raw as any).expenses_data;
        }
        // Для analytics/overall: перевіряємо data.expenses або data.expense_stats
        else if (attempt.path.includes("analytics/overall")) {
          const analyticsData = (raw as any).data || raw;
          if (analyticsData && typeof analyticsData === "object") {
            // Шукаємо масиви транзакцій витрат
            if (Array.isArray(analyticsData.expenses)) {
              fetched = analyticsData.expenses;
            } else if (Array.isArray(analyticsData.expense_transactions)) {
              fetched = analyticsData.expense_transactions;
            } else if (analyticsData.expense_stats && Array.isArray(analyticsData.expense_stats.items)) {
              fetched = analyticsData.expense_stats.items;
            }
            // Якщо знайшли щось, логуємо
            if (fetched.length > 0) {
              console.log(`[altegio/expenses] ✅ Found ${fetched.length} expenses in analytics/overall`);
            }
          }
        }
      }

      if (fetched.length > 0) {
        transactions = fetched;
        console.log(
          `[altegio/expenses] ✅ Got ${transactions.length} transactions using ${attempt.name}`,
        );
        
        // Перевіряємо, чи є серед транзакцій "Податки та збори"
        const taxesTransactions = transactions.filter((t: any) => {
          const expenseTitle = t.expense?.title || t.expense?.name || "";
          const comment = t.comment || "";
          return expenseTitle.toLowerCase().includes("подат") ||
                 expenseTitle.toLowerCase().includes("tax") ||
                 comment.toLowerCase().includes("подат") ||
                 comment.toLowerCase().includes("налмн");
        });
        
        if (taxesTransactions.length > 0) {
          console.log(`[altegio/expenses] ✅ Found ${taxesTransactions.length} tax-related transactions:`, 
            taxesTransactions.map((t: any) => ({
              id: t.id,
              amount: t.amount,
              expense_title: t.expense?.title,
              comment: t.comment,
            }))
          );
        } else {
          console.log(`[altegio/expenses] ⚠️ No tax-related transactions found in ${transactions.length} transactions`);
        }
        
        // Логуємо всі унікальні категорії витрат для діагностики
        const uniqueCategories = new Set<string>();
        transactions.forEach((t: any) => {
          const category = t.expense?.title || t.expense?.name || t.comment || "Unknown";
          uniqueCategories.add(category);
        });
        console.log(`[altegio/expenses] Unique expense categories found (${uniqueCategories.size}):`, 
          Array.from(uniqueCategories).slice(0, 20)
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
    
    // Якщо є ручні витрати, використовуємо їх
    if (manualExpenses !== null && manualExpenses > 0) {
      console.log(`[altegio/expenses] ✅ Using manual expenses: ${manualExpenses}`);
      return {
        range: { date_from, date_to },
        total: manualExpenses,
        byCategory: { "Ручні витрати": manualExpenses },
        transactions: [],
        categories,
      };
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

  // ВИТЯГУЄМО ВСІ ФІНАНСОВІ ОПЕРАЦІЇ БЕЗ ЖОДНИХ ФІЛЬТРІВ
  // Згідно з запитом користувача: витягувати ВСІ транзакції як є, без фільтрації
  // Відфільтруємо потім, але зараз витягуємо ВСЕ
  if (transactions.length > 0) {
    console.log(`[altegio/expenses] Sample transaction:`, JSON.stringify(transactions[0], null, 2));
    console.log(`[altegio/expenses] Total transactions: ${transactions.length} (NO FILTERING)`);
  }
  
  // Логуємо статистику транзакцій
  const transactionsWithExpense = transactions.filter(t => t.expense_id || t.expense).length;
  const transactionsWithoutExpense = transactions.length - transactionsWithExpense;
  console.log(`[altegio/expenses] Transactions with expense: ${transactionsWithExpense}, without expense: ${transactionsWithoutExpense}`);
  
  // НЕ ФІЛЬТРУЄМО НІЧОГО - ВКЛЮЧАЄМО ВСІ ТРАНЗАКЦІЇ
  // Користувач просив витягувати все як є, відфільтруємо потім
  const expenses = transactions; // Включаємо ВСІ транзакції без винятку
  
  console.log(`[altegio/expenses] ✅ Including ALL ${expenses.length} transactions (NO FILTERING)`);
  
  // Логуємо ВСІ унікальні категорії для порівняння з UI
  const allRawCategories = new Set<string>();
  expenses.forEach((t) => {
    const category = t.expense?.title || 
                    t.expense?.name || 
                    t.comment || 
                    t.type || 
                    "Unknown";
    allRawCategories.add(category);
  });
  
  console.log(`[altegio/expenses] 📊 ALL RAW CATEGORIES FROM API (${allRawCategories.size} total):`, 
    Array.from(allRawCategories).sort()
  );
  
  // Логуємо перші кілька транзакцій для діагностики
  expenses.slice(0, 20).forEach((t, index) => {
    const expenseId = t.expense_id || t.expense?.id;
    const expenseTitle = t.expense?.title || t.expense?.name || "";
    const comment = t.comment || "";
    console.log(`[altegio/expenses] Transaction ${index + 1}/${expenses.length} (ID: ${t.id}):`, {
      expense_id: expenseId,
      expense_title: expenseTitle,
      expense_name: t.expense?.name,
      type: t.type,
      type_id: (t as any).type_id,
      amount: t.amount,
      comment: comment.substring(0, 100),
      hasExpense: !!(t.expense_id || t.expense),
      date: t.date,
    });
  });

  // Групуємо по категоріях (expense.name або expense.category)
  const byCategory: Record<string, number> = {};
  let total = 0;

  // Функція для нормалізації назви категорії
  // Об'єднуємо схожі назви в одну категорію
  function normalizeCategoryName(rawName: string): string {
    const name = rawName.trim();
    if (!name) return "Інші витрати";
    
    const lower = name.toLowerCase();
    
    // Нормалізуємо "Податки та збори" / "Taxes and fees" / "Податки" / "Taxes"
    if (lower.includes("подат") || lower.includes("tax") || lower.includes("збор") || lower.includes("fee")) {
      return "Податки та збори";
    }
    
    // Нормалізуємо "Зарплата" / "Team salaries" / "ЗП"
    if (lower.includes("зарплат") || lower.includes("salary") || lower === "зп" || lower.includes("team salaries")) {
      return "Зарплата співробітникам";
    }
    
    // Нормалізуємо "Оренда" / "Rent"
    if (lower.includes("оренд") || lower.includes("rent")) {
      return "Оренда";
    }
    
    // Нормалізуємо "Бухгалтерія" / "Accounting"
    if (lower.includes("бухгалтер") || lower.includes("accounting")) {
      return "Бухгалтерія";
    }
    
    // Нормалізуємо "Маркетинг" / "Marketing"
    if (lower.includes("маркетинг") || lower.includes("marketing")) {
      return "Маркетинг";
    }
    
    // Нормалізуємо "Реклама" / "Advertising"
    if (lower.includes("реклам") || lower.includes("advertising") || lower.includes("реклама, бюджет")) {
      return "Реклама, Бюджет, ФБ";
    }
    
    // Нормалізуємо "Дірект" / "Direct"
    if (lower.includes("дірект") || lower.includes("direct")) {
      return "Дірект";
    }
    
    // Нормалізуємо "Комісія за еквайринг" / "Acquiring fee" (спочатку перевіряємо більш специфічну назву)
    // Перевіряємо різні варіанти написання
    if (lower === "acquiring fee" ||
        name === "Acquiring fee" ||
        name === "acquiring fee" ||
        lower.includes("комісія за еквайринг") || 
        lower.includes("комиссия за эквайринг") || 
        lower.includes("комісія за acquiring") || 
        lower.includes("комиссия за acquiring") ||
        lower.includes("commission for acquiring") ||
        lower.includes("acquiring fee") ||
        lower.includes("комісія за еквайрінг") ||
        lower.includes("комиссия за эквайринг") ||
        name === "Комісія за еквайринг" ||
        name === "Комиссия за эквайринг") {
      return "Комісія за еквайринг";
    }
    
    // Нормалізуємо "Еквайринг" / "Acquiring" (загальна назва)
    // Але тільки якщо це не "Комісія за еквайринг"
    if ((lower.includes("еквайринг") || lower.includes("acquiring")) && 
        !lower.includes("комісія") && !lower.includes("комиссия") && !lower.includes("commission")) {
      return "Еквайринг";
    }
    
    // Нормалізуємо "Доставка товарів" / "Delivery" / різні варіанти
    if ((lower.includes("доставка товарів") || lower.includes("доставка")) && 
        (lower.includes("нова пошта") || lower.includes("nova poshta") || lower.includes("нп") || lower.includes("каса нова пошта"))) {
      return "Доставка товарів (Нова Пошта)";
    }
    
    // Нормалізуємо "Інтернет" / "Internet" / "CRM" / різні варіанти
    if ((lower.includes("інтернет") || lower.includes("internet") || lower.includes("інтеренет")) && 
        (lower.includes("crm") || lower.includes("ip") || lower.includes("ір") || lower.includes("комунальні"))) {
      return "Інтернет, CRM і т д.";
    }
    // Також нормалізуємо просто "Інтернет" / "Internet"
    if (lower.includes("інтернет") || lower.includes("internet") || lower.includes("інтеренет")) {
      return "Інтернет, CRM і т д.";
    }
    
    // Виключаємо доходи, які не повинні бути в витратах
    if (lower.includes("service payments") || 
        lower.includes("product sales") ||
        lower.includes("продаж послуг") ||
        lower.includes("надання послуг")) {
      return "Service payments"; // Помічаємо для подальшого виключення
    }
    
    // Ремонт обладнання, інструментів
    if (lower.includes("ремонт") && (lower.includes("обладнання") || lower.includes("інструмент"))) {
      return "Ремонт обладнання, інструментів";
    }
    
    // Повертаємо оригінальну назву, якщо не знайшли нормалізацію
    return name;
  }

  for (const expense of expenses) {
    const amount = Math.abs(toNumber(expense.amount)); // Беремо абсолютне значення
    total += amount;

    // Визначаємо категорію витрати
    // Згідно з Payments API, expense об'єкт має id та title
    // Але тепер ми також включаємо транзакції без expense об'єкта
    let categoryName = "Інші витрати";
    
    // Спочатку перевіряємо, чи це стаття витрат "Комісія за еквайринг" (прямий пошук)
    const expenseTitleRaw = expense.expense?.title || "";
    const expenseNameRaw = expense.expense?.name || "";
    const commentRaw = expense.comment || "";
    const expenseTitleLower = expenseTitleRaw.toLowerCase();
    const expenseNameLower = expenseNameRaw.toLowerCase();
    const commentLower = commentRaw.toLowerCase();
    
    // Прямий пошук статті витрат "Комісія за еквайринг" / "Acquiring fee" - якщо знайдено, одразу присвоюємо категорію
    if (expenseTitleRaw === "Комісія за еквайринг" || 
        expenseTitleRaw === "Комиссия за эквайринг" ||
        expenseTitleRaw === "Acquiring fee" ||
        expenseTitleRaw === "acquiring fee" ||
        expenseNameRaw === "Комісія за еквайринг" ||
        expenseNameRaw === "Комиссия за эквайринг" ||
        expenseNameRaw === "Acquiring fee" ||
        (expenseTitleLower.includes("комісія") && expenseTitleLower.includes("еквайринг")) ||
        (expenseTitleLower.includes("комиссия") && expenseTitleLower.includes("эквайринг")) ||
        (expenseTitleLower.includes("acquiring") && expenseTitleLower.includes("fee")) ||
        (expenseNameLower.includes("комісія") && expenseNameLower.includes("еквайринг")) ||
        (expenseNameLower.includes("комиссия") && expenseNameLower.includes("эквайринг")) ||
        (expenseNameLower.includes("acquiring") && expenseNameLower.includes("fee"))) {
      categoryName = "Комісія за еквайринг";
    }
    // Пріоритет 1: мапа категорій за expense_id (найнадійніше, якщо мапа заповнена)
    else if (expense.expense_id && categoryMap.has(expense.expense_id)) {
      const mappedName = categoryMap.get(expense.expense_id)!;
      const mappedNameLower = mappedName.toLowerCase();
      // Перевіряємо, чи в мапі є "Комісія за еквайринг" / "Acquiring fee"
      if ((mappedNameLower.includes("комісія") && mappedNameLower.includes("еквайринг")) ||
          (mappedNameLower.includes("комиссия") && mappedNameLower.includes("эквайринг")) ||
          mappedNameLower === "acquiring fee" ||
          (mappedNameLower.includes("acquiring") && mappedNameLower.includes("fee"))) {
        categoryName = "Комісія за еквайринг";
      } else {
        categoryName = normalizeCategoryName(mappedName);
      }
    }
    // Пріоритет 2: expense.title (якщо немає в мапі)
    else if (expense.expense?.title) {
      categoryName = normalizeCategoryName(expense.expense.title);
    }
    // Пріоритет 3: expense.name
    else if (expense.expense?.name) {
      categoryName = normalizeCategoryName(expense.expense.name);
    }
    // Пріоритет 4: expense.category
    else if (expense.expense?.category) {
      categoryName = normalizeCategoryName(expense.expense.category);
    }
    // Пріоритет 5: comment як fallback (якщо є осмислений коментар)
    else if (expense.comment && expense.comment.trim().length > 0) {
      // Перевіряємо, чи коментар містить ключові слова для категорій
      const commentLower = expense.comment.toLowerCase();
      if (commentLower.includes("подат") || commentLower.includes("tax") || commentLower.includes("налмн")) {
        categoryName = "Податки та збори";
      } else if ((commentLower.includes("комісія") && commentLower.includes("еквайринг")) ||
                 (commentLower.includes("комиссия") && commentLower.includes("эквайринг"))) {
        // Якщо в коментарі є згадка про "Комісія за еквайринг", одразу присвоюємо
        categoryName = "Комісія за еквайринг";
      } else if (commentLower.includes("еквайринг") || commentLower.includes("acquiring")) {
        // Якщо в коментарі є згадка про еквайринг (без "комісія"), нормалізуємо
        categoryName = normalizeCategoryName(expense.comment);
      } else {
        // Використовуємо comment, але обмежуємо довжину для читабельності
        categoryName = expense.comment.length > 50 
          ? expense.comment.substring(0, 50) + "..."
          : expense.comment;
      }
    }
    // Пріоритет 6: type як fallback
    else if (expense.type) {
      categoryName = `Транзакція (${expense.type})`;
    }
    // Пріоритет 7: якщо немає нічого - використовуємо "Інші витрати"
    // (це вже встановлено вище)

    byCategory[categoryName] = (byCategory[categoryName] || 0) + amount;
    
    // Діагностика для "Комісія за еквайринг"
    const rawExpenseTitle = expense.expense?.title || expense.expense?.name || "";
    const rawExpenseName = expense.expense?.name || "";
    if (rawExpenseTitle.toLowerCase().includes("еквайринг") || 
        rawExpenseTitle.toLowerCase().includes("acquiring") ||
        rawExpenseName.toLowerCase().includes("еквайринг") ||
        rawExpenseName.toLowerCase().includes("acquiring") ||
        (expense.comment && expense.comment.toLowerCase().includes("еквайринг"))) {
      console.log(`[altegio/expenses] 🔍 Found acquiring-related transaction:`, {
        id: expense.id,
        amount: expense.amount,
        expense_title: rawExpenseTitle,
        expense_name: rawExpenseName,
        expense_id: expense.expense_id,
        comment: expense.comment,
        normalized_category: categoryName,
        date: expense.date,
      });
    }
  }
  
  // Логуємо статистику по категоріях
  console.log(`[altegio/expenses] Categories found:`, Object.keys(byCategory));
  if (byCategory["Податки та збори"]) {
    console.log(`[altegio/expenses] ✅ Found "Податки та збори": ${byCategory["Податки та збори"]} грн.`);
  } else {
    console.log(`[altegio/expenses] ⚠️ "Податки та збори" category NOT found in ${Object.keys(byCategory).length} categories`);
  }
  
  // Діагностика для "Комісія за еквайринг"
  if (byCategory["Комісія за еквайринг"]) {
    console.log(`[altegio/expenses] ✅ Found "Комісія за еквайринг": ${byCategory["Комісія за еквайринг"]} грн.`);
  } else {
    console.log(`[altegio/expenses] ⚠️ "Комісія за еквайринг" category NOT found in ${Object.keys(byCategory).length} categories`);
    // Шукаємо схожі категорії
    const similarCategories = Object.keys(byCategory).filter(k => 
      k.toLowerCase().includes("еквайринг") || 
      k.toLowerCase().includes("acquiring") ||
      k.toLowerCase().includes("комісія")
    );
    if (similarCategories.length > 0) {
      console.log(`[altegio/expenses] 🔍 Found similar categories:`, similarCategories);
    }
  }

  // Якщо є ручні витрати, додаємо їх до загальної суми
  let finalTotal = total;
  if (manualExpenses !== null && manualExpenses > 0) {
    // Якщо є транзакції з API, додаємо ручні витрати окремою категорією
    if (total > 0) {
      byCategory["Ручні витрати"] = (byCategory["Ручні витрати"] || 0) + manualExpenses;
      finalTotal = total + manualExpenses;
    } else {
      // Якщо немає транзакцій з API, використовуємо тільки ручні витрати
      finalTotal = manualExpenses;
      byCategory["Ручні витрати"] = manualExpenses;
    }
    console.log(`[altegio/expenses] Added manual expenses: ${manualExpenses}, final total: ${finalTotal}`);
  }

  console.log(
    `[altegio/expenses] Total expenses: ${finalTotal}, Categories: ${Object.keys(byCategory).length}`,
  );

  return {
    range: { date_from, date_to },
    total: finalTotal,
    byCategory,
    transactions: expenses,
    categories,
  };
}

