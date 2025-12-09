// web/app/admin/finance-report/page.tsx
import {
  fetchFinanceSummary,
  fetchGoodsSalesSummary,
  fetchExpensesSummary,
  type FinanceSummary,
  type GoodsSalesSummary,
  type ExpensesSummary,
} from "@/lib/altegio";
import { EditCostButton } from "./_components/EditCostButton";
import { EditExpensesButton } from "./_components/EditExpensesButton";
import { EditExpenseField } from "./_components/EditExpenseField";
import { EditExchangeRateField } from "./_components/EditExchangeRateField";
import { EditWarehouseBalanceButton } from "./_components/EditWarehouseBalanceButton";
import { EditNumberField } from "./_components/EditNumberField";
import { CollapsibleSection } from "./_components/CollapsibleSection";
import { getWarehouseBalance } from "@/lib/altegio";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateHuman(value: string | Date | number): string {
  // Завжди нормалізуємо в Date, навіть якщо вхід може бути number або іншим типом
  const d = new Date(value as any);
  return d.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}

type MonthOption = { month: number; label: string };

function getLastCompleteMonth(today: Date): { year: number; month: number } {
  const d = new Date(today.getFullYear(), today.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function buildMonthOptions(today: Date): MonthOption[] {
  const options: MonthOption[] = [];
  const baseYear = today.getFullYear();

  const formatter = new Intl.DateTimeFormat("uk-UA", {
    month: "long",
  });

  for (let month = 1; month <= 12; month++) {
    const d = new Date(baseYear, month - 1, 1);
    const rawLabel = formatter.format(d);
    const label =
      rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    options.push({ month, label });
  }

  return options;
}

function monthRange(year: number, month: number): {
  from: string;
  to: string;
} {
  const fromDate = new Date(year, month - 1, 1);
  const toDate = new Date(year, month, 0); // останній день місяця
  return {
    from: formatDateISO(fromDate),
    to: formatDateISO(toDate),
  };
}

/**
 * Отримати значення ручного поля витрат з KV
 */
async function getManualExpenseField(
  year: number,
  month: number,
  fieldKey: string,
): Promise<number> {
  try {
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const key = `finance:expenses:${fieldKey}:${year}:${month}`;
      const rawValue = await kvReadModule.getRaw(key);
      if (rawValue !== null && typeof rawValue === "string") {
        try {
          const parsed = JSON.parse(rawValue);
          const value = (parsed as any)?.value ?? parsed;
          const numValue = typeof value === "number" ? value : parseFloat(String(value));
          if (Number.isFinite(numValue) && numValue >= 0) {
            return numValue;
          }
        } catch {
          const numValue = parseFloat(rawValue);
          if (Number.isFinite(numValue) && numValue >= 0) {
            return numValue;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[finance-report] Failed to read manual expense field ${fieldKey}:`, err);
  }
  return 0;
}

async function getSummaryForMonth(
  year: number,
  month: number,
): Promise<{
  summary: FinanceSummary | null;
  goods: GoodsSalesSummary | null;
  expenses: ExpensesSummary | null;
  manualExpenses: number | null;
  manualFields: Record<string, number>; // Ручні поля витрат
  exchangeRate: number; // Курс долара
  warehouseBalance: number; // Баланс складу на останній день місяця
  warehouseBalanceDiff: number; // Різниця балансу складу між поточним та попереднім місяцем
  hairPurchaseAmount: number; // Сума для закупівлі волосся (собівартість округлена до більшого до 10000)
  encashment: number; // Інкасація: Собівартість + Чистий прибуток власника - Закуплений товар - Інвестиції + Платежі з ФОП Ореховська
  fopOrekhovskaPayments: number; // Сума платежів з ФОП Ореховська
  ownerProfit: number; // Чистий прибуток власника (profit - management)
  encashmentComponents: {
    cost: number; // Собівартість
    ownerProfit: number; // Чистий прибуток власника
    productPurchase: number; // Закуплений товар
    investments: number; // Інвестиції
    fopPayments: number; // Платежі з ФОП Ореховська
  };
  error: string | null;
}> {
  const { from, to } = monthRange(year, month);

  // Отримуємо ручні витрати з KV (старе поле для сумісності)
  let manualExpenses: number | null = null;
  try {
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const expensesKey = `finance:expenses:${year}:${month}`;
      const rawValue = await kvReadModule.getRaw(expensesKey);
      if (rawValue !== null && typeof rawValue === "string") {
        try {
          const parsed = JSON.parse(rawValue);
          const value = (parsed as any)?.value ?? parsed;
          const numValue = typeof value === "number" ? value : parseFloat(String(value));
          if (Number.isFinite(numValue) && numValue >= 0) {
            manualExpenses = numValue;
          }
        } catch {
          const numValue = parseFloat(rawValue);
          if (Number.isFinite(numValue) && numValue >= 0) {
            manualExpenses = numValue;
          }
        }
      }
    }
  } catch (err) {
    console.error("[finance-report] Failed to read manual expenses:", err);
  }

  // Отримуємо всі ручні поля витрат
  const manualFields: Record<string, number> = {};
  const fieldKeys = [
    "salary", // ЗП
    "rent", // Оренда
    "accounting", // Бухгалтерія
    "direct", // Дірект
    "taxes_extra", // Додаткові податки (якщо API не покриває всю суму)
    "acquiring", // Еквайринг
    "consultations_count", // Кількість Консультацій
    "new_paid_clients", // Нових платних клієнтів
  ];
  
  for (const fieldKey of fieldKeys) {
    manualFields[fieldKey] = await getManualExpenseField(year, month, fieldKey);
  }

  // Отримуємо курс долара з KV
  let exchangeRate = 0;
  try {
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const rateKey = `finance:exchange-rate:usd:${year}:${month}`;
      const rawValue = await kvReadModule.getRaw(rateKey);
      if (rawValue !== null && typeof rawValue === "string") {
        try {
          const parsed = JSON.parse(rawValue);
          const value = (parsed as any)?.value ?? parsed;
          const numValue = typeof value === "number" ? value : parseFloat(String(value));
          if (Number.isFinite(numValue) && numValue > 0) {
            exchangeRate = numValue;
          }
        } catch {
          const numValue = parseFloat(rawValue);
          if (Number.isFinite(numValue) && numValue > 0) {
            exchangeRate = numValue;
          }
        }
      }
    }
  } catch (err) {
    console.error("[finance-report] Failed to read exchange rate:", err);
  }

  // Функція для отримання балансу складу для конкретного місяця/року
  async function getWarehouseBalanceForMonth(year: number, month: number): Promise<number> {
    let balance = 0;
    let manualBalance: number | null = null;
    
    try {
      const kvModule = await import("@/lib/kv");
      const kvReadModule = kvModule.kvRead;
      if (kvReadModule && typeof kvReadModule.getRaw === "function") {
        const balanceKey = `finance:warehouse:balance:${year}:${month}`;
        const rawValue = await kvReadModule.getRaw(balanceKey);
        if (rawValue !== null && typeof rawValue === "string") {
          try {
            const parsed = JSON.parse(rawValue);
            const value = (parsed as any)?.value ?? parsed;
            const numValue = typeof value === "number" ? value : parseFloat(String(value));
            if (Number.isFinite(numValue) && numValue >= 0) {
              manualBalance = numValue;
            }
          } catch {
            const numValue = parseFloat(rawValue);
            if (Number.isFinite(numValue) && numValue >= 0) {
              manualBalance = numValue;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[finance-report] Failed to read manual warehouse balance for ${year}-${month}:`, err);
    }
    
    // Якщо є ручне значення, використовуємо його, інакше отримуємо з API
    if (manualBalance !== null) {
      balance = manualBalance;
    } else {
      try {
        const monthRangeForBalance = monthRange(year, month);
        balance = await getWarehouseBalance({ date: monthRangeForBalance.to });
      } catch (err) {
        console.error(`[finance-report] Failed to get warehouse balance for ${year}-${month}:`, err);
      }
    }
    
    return balance;
  }

  // Отримуємо баланс складу на останній день поточного місяця
  const warehouseBalance = await getWarehouseBalanceForMonth(year, month);
  
  // Отримуємо баланс складу попереднього місяця для розрахунку різниці
  let previousMonthBalance = 0;
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  previousMonthBalance = await getWarehouseBalanceForMonth(previousYear, previousMonth);
  
  // Розраховуємо різницю
  const warehouseBalanceDiff = warehouseBalance - previousMonthBalance;

  try {
    const [summary, goods, expenses] = await Promise.all([
      fetchFinanceSummary({
        date_from: from,
        date_to: to,
      }),
      fetchGoodsSalesSummary({
        date_from: from,
        date_to: to,
      }),
      fetchExpensesSummary({
        date_from: from,
        date_to: to,
      }),
    ]);
    
    // Розраховуємо суму для закупівлі волосся: собівартість округлена до більшого до 10000
    const hairPurchaseAmount = goods && goods.cost > 0 
      ? Math.ceil(goods.cost / 10000) * 10000 
      : 0;
    
    // Розраховуємо інкасацію: Собівартість + Чистий прибуток власника - Закуплений товар - Інвестиції + Платежі з ФОП Ореховська
    // Спочатку отримуємо дані для розрахунку
    const cost = goods?.cost || 0;
    // Шукаємо "Закуплений товар" в різних варіантах назв
    const productPurchase = expenses?.byCategory["Product purchase"] || 
                            expenses?.byCategory["Закуплено товару"] || 
                            expenses?.byCategory["Закуплений товар"] || 
                            0;
    const investments = expenses?.byCategory["Інвестиції в салон"] || 
                       expenses?.byCategory["Инвестиции в салон"] || 
                       expenses?.byCategory["Інвестиції"] ||
                       0;
    const management = expenses?.byCategory["Управління"] || expenses?.byCategory["Управление"] || 0;
    
    // Розраховуємо прибуток та чистий прибуток власника
    const services = summary?.totals.services || 0;
    const markup = summary && goods ? (summary.totals.goods - goods.cost) : 0;
    const totalIncome = services + markup;
    
    // Розраховуємо totalExpenses так само, як в UI компоненті, щоб ownerProfit збігався
    const salaryFromAPI = expenses?.byCategory["Зарплата співробітникам"] || expenses?.byCategory["Team salaries"] || 0;
    const rentFromAPI = expenses?.byCategory["Оренда"] || expenses?.byCategory["Rent"] || 0;
    const rentManual = manualFields.rent || 0;
    const rent = rentFromAPI > 0 ? rentFromAPI : rentManual;
    const cmmFromAPI = expenses?.byCategory["Маркетинг"] || expenses?.byCategory["Marketing"] || 0;
    const targetFromAPI = expenses?.byCategory["Таргет оплата роботи маркетологів"] || 0;
    const advertisingFromAPI = expenses?.byCategory["Реклама, Бюджет, ФБ"] || 0;
    const directFromAPI = expenses?.byCategory["Дірект"] || expenses?.byCategory["Direct"] || 0;
    const directManual = manualFields.direct || 0;
    const direct = directFromAPI > 0 ? directFromAPI : directManual;
    const taxesFromAPI = expenses?.byCategory["Податки та збори"] || expenses?.byCategory["Taxes and fees"] || 0;
    const taxesExtraManual = manualFields.taxes_extra || 0;
    const miscExpensesFromAPI = expenses?.byCategory["Miscellaneous expenses"] || expenses?.byCategory["Інші витрати"] || 0;
    const deliveryFromAPI = expenses?.byCategory["Доставка товарів (Нова Пошта)"] || 
                           expenses?.byCategory["Доставка товарів (Каса Нова Пошта)"] ||
                           expenses?.byCategory["Доставка товарів"] ||
                           0;
    const consumablesFromAPI = expenses?.byCategory["Consumables purchase"] || expenses?.byCategory["Закупівля матеріалів"] || 0;
    const stationeryFromAPI = expenses?.byCategory["Канцелярські, миючі товари та засоби"] || 0;
    const productsForGuestsFromAPI = expenses?.byCategory["Продукти для гостей"] || 0;
    const acquiringFromAPI = expenses?.byCategory["Еквайринг"] || expenses?.byCategory["Acquiring"] || 0;
    const acquiringManual = manualFields.acquiring || 0;
    const acquiring = acquiringFromAPI > 0 ? acquiringFromAPI : acquiringManual;
    const utilitiesFromAPI = expenses?.byCategory["Інтернет, CRM і т д."] ||
                           expenses?.byCategory["Інтеренет, CRM, IP і т. д."] ||
                           expenses?.byCategory["Комунальні, Інтеренет, ІР і т. д."] || 
                           expenses?.byCategory["Комунальні, Інтеренет, IP і т. д."] ||
                           0;
    const accountingFromAPI = expenses?.byCategory["Бухгалтерія"] || expenses?.byCategory["Accounting"] || 0;
    const accountingManual = manualFields.accounting || 0;
    const accounting = accountingFromAPI > 0 ? accountingFromAPI : accountingManual;
    
    const salary = salaryFromAPI;
    const marketingTotal = cmmFromAPI + targetFromAPI + advertisingFromAPI + direct;
    const taxes = taxesFromAPI + taxesExtraManual;
    const otherExpensesTotal = miscExpensesFromAPI + deliveryFromAPI + consumablesFromAPI + stationeryFromAPI + productsForGuestsFromAPI + acquiring + utilitiesFromAPI;
    const expensesWithoutSalary = rent + marketingTotal + taxes + otherExpensesTotal + accounting;
    const totalExpenses = salary + expensesWithoutSalary;
    
    const profit = totalIncome - totalExpenses;
    const ownerProfit = profit - management;
    
    // Знаходимо всі платежі з ФОП Ореховська
    // Фільтруємо по account.title (як показано в API response)
    let fopOrekhovskaPayments = 0;
    if (expenses?.transactions && Array.isArray(expenses.transactions)) {
      fopOrekhovskaPayments = expenses.transactions
        .filter((t: any) => {
          // Перевіряємо account.title (основний спосіб згідно з API)
          const accountTitle = (t.account?.title || "").toLowerCase();
          // Також перевіряємо account.name для сумісності
          const accountName = (t.account?.name || "").toLowerCase();
          // Додатково перевіряємо comment та expense.title на випадок, якщо account не вказано
          const comment = (t.comment || "").toLowerCase();
          const expenseTitle = ((t.expense?.title || t.expense?.name) || "").toLowerCase();
          
          // Шукаємо "фоп ореховська" або "ореховська" в account.title (пріоритет)
          if (accountTitle.includes("фоп ореховська") || accountTitle.includes("фоп ореховская") || 
              accountTitle.includes("ореховська") || accountTitle.includes("ореховская")) {
            return true;
          }
          
          // Fallback: перевіряємо інші поля
          const searchText = (accountName + " " + comment + " " + expenseTitle);
          return searchText.includes("ореховська") || searchText.includes("ореховская") || 
                 searchText.includes("фоп ореховська") || searchText.includes("фоп ореховская");
        })
        .reduce((sum: number, t: any) => {
          const amount = Math.abs(Number(t.amount) || 0);
          return sum + amount;
        }, 0);
      
      // Логуємо для діагностики
      if (fopOrekhovskaPayments > 0) {
        const matchingTransactions = expenses.transactions.filter((t: any) => {
          const accountTitle = (t.account?.title || "").toLowerCase();
          return accountTitle.includes("ореховська") || accountTitle.includes("ореховская");
        });
        console.log(`[finance-report] ✅ Found ${matchingTransactions.length} transactions with ФОП Ореховська account, total: ${fopOrekhovskaPayments} грн.`);
      }
    }
    
    // Розраховуємо інкасацію за формулою:
    // Собівартість + Чистий прибуток власника - Закуплений товар - Інвестиції + Платежі з ФОП Ореховська
    // ВАЖЛИВО: Використовуємо той самий ownerProfit, який показується в UI (profit - management)
    // За формулою користувача потрібно відняти productPurchase та investments,
    // навіть якщо вони вже включені в totalExpenses (і таким чином в ownerProfit).
    // Це означає, що ми віднімаємо їх додатково, що може бути навмисним для користувача.
    // Використовуємо звичайний ownerProfit (той самий, що в UI):
    const encashment = cost + ownerProfit - productPurchase - investments + fopOrekhovskaPayments;
    
    // Логуємо для діагностики
    const productPurchaseValue = expenses?.byCategory["Product purchase"] || 
                                 expenses?.byCategory["Закуплено товару"] || 
                                 expenses?.byCategory["Закуплений товар"] || 
                                 0;
    const investmentsValue = expenses?.byCategory["Інвестиції в салон"] || 
                            expenses?.byCategory["Инвестиции в салон"] || 
                            expenses?.byCategory["Інвестиції"] ||
                            0;
    
    console.log(`[finance-report] 📊 Інкасація розрахунок:`, {
      cost,
      ownerProfit,
      productPurchase,
      productPurchaseValue,
      investments,
      investmentsValue,
      fopOrekhovskaPayments,
      totalExpenses,
      totalIncome,
      profit,
      management,
      encashment,
      calculation: `${cost} + ${ownerProfit} - ${productPurchase} - ${investments} + ${fopOrekhovskaPayments}`,
      expected: cost + ownerProfit - productPurchase - investments + fopOrekhovskaPayments,
      actual: encashment,
      // Додаткова діагностика для перевірки, що ownerProfit правильний
      ownerProfitCalculation: `${profit} - ${management} = ${ownerProfit}`,
      profitCalculation: `${totalIncome} - ${totalExpenses} = ${profit}`,
      allCategories: expenses?.byCategory ? Object.keys(expenses.byCategory).sort() : [],
      productPurchaseCategories: expenses?.byCategory ? Object.keys(expenses.byCategory).filter(k => 
        k.toLowerCase().includes("product") || k.toLowerCase().includes("закуп") || k.toLowerCase().includes("purchase")
      ) : [],
      investmentCategories: expenses?.byCategory ? Object.keys(expenses.byCategory).filter(k => 
        k.toLowerCase().includes("інвест") || k.toLowerCase().includes("инвест") || k.toLowerCase().includes("investment")
      ) : [],
      productPurchaseFromCategory: expenses?.byCategory ? {
        "Product purchase": expenses.byCategory["Product purchase"],
        "Закуплено товару": expenses.byCategory["Закуплено товару"],
        "Закуплений товар": expenses.byCategory["Закуплений товар"],
      } : {},
      investmentsFromCategory: expenses?.byCategory ? {
        "Інвестиції в салон": expenses.byCategory["Інвестиції в салон"],
        "Инвестиции в салон": expenses.byCategory["Инвестиции в салон"],
        "Інвестиції": expenses.byCategory["Інвестиції"],
      } : {},
    });
    
    return { 
      summary, 
      goods, 
      expenses, 
      manualExpenses, 
      manualFields, 
      exchangeRate,
      warehouseBalance,
      warehouseBalanceDiff,
      hairPurchaseAmount,
      encashment,
      fopOrekhovskaPayments,
      ownerProfit,
      encashmentComponents: {
        cost,
        ownerProfit: ownerProfit, // Використовуємо той самий ownerProfit, що показується в UI
        productPurchase,
        investments,
        fopPayments: fopOrekhovskaPayments,
      },
      error: null 
    };
  } catch (e: any) {
    return {
      summary: null,
      goods: null,
      expenses: null,
      manualExpenses: null,
      manualFields: {},
      exchangeRate: 0,
      warehouseBalance: 0,
      warehouseBalanceDiff: 0,
      hairPurchaseAmount: 0,
      encashment: 0,
      fopOrekhovskaPayments: 0,
      ownerProfit: 0,
      encashmentComponents: {
        cost: 0,
        ownerProfit: 0,
        productPurchase: 0,
        investments: 0,
        fopPayments: 0,
      },
      error: String(e?.message || e),
    };
  }
}

export default async function FinanceReportPage({
  searchParams,
}: {
  searchParams?: { year?: string; month?: string };
}) {
  // Вимкнути кешування для завжди свіжих даних
  noStore();
  
  const today = new Date();
  const lastComplete = getLastCompleteMonth(today);

  const selectedYear = searchParams?.year
    ? Number(searchParams.year)
    : lastComplete.year;
  const selectedMonth = searchParams?.month
    ? Number(searchParams.month)
    : lastComplete.month;

  const monthOptions = buildMonthOptions(today);
  const currentYear = today.getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  const { summary, goods, expenses, manualExpenses, manualFields, exchangeRate, warehouseBalance, warehouseBalanceDiff, hairPurchaseAmount, encashment, fopOrekhovskaPayments, ownerProfit, encashmentComponents, error } = await getSummaryForMonth(
    selectedYear,
    selectedMonth,
  );

  // Дані для компактного дашборду (використовуємо ті ж формули, що й у секції "Прибуток")
  const servicesDashboard = summary?.totals.services || 0;
  const goodsRevenueDashboard = summary?.totals.goods || 0;
  const goodsCostDashboard = goods?.cost || 0;
  const markupDashboard = summary && goods ? goodsRevenueDashboard - goodsCostDashboard : 0;
  const totalIncomeDashboard = servicesDashboard + markupDashboard;
  // Витрати (ідентично блоку "Прибуток")
  const salaryFromAPI_dashboard = expenses?.byCategory["Зарплата співробітникам"] || expenses?.byCategory["Team salaries"] || 0;
  const rentFromAPI_dashboard = expenses?.byCategory["Оренда"] || expenses?.byCategory["Rent"] || 0;
  const rentManual_dashboard = manualFields.rent || 0;
  const rent_dashboard = rentFromAPI_dashboard > 0 ? rentFromAPI_dashboard : rentManual_dashboard;
  const accountingFromAPI_dashboard = expenses?.byCategory["Бухгалтерія"] || expenses?.byCategory["Accounting"] || 0;
  const accountingManual_dashboard = manualFields.accounting || 0;
  const accounting_dashboard = accountingFromAPI_dashboard > 0 ? accountingFromAPI_dashboard : accountingManual_dashboard;
  const cmmFromAPI_dashboard = expenses?.byCategory["Маркетинг"] || expenses?.byCategory["Marketing"] || 0;
  const targetFromAPI_dashboard = expenses?.byCategory["Таргет оплата роботи маркетологів"] || 0;
  const advertisingFromAPI_dashboard = expenses?.byCategory["Реклама, Бюджет, ФБ"] || 0;
  const directFromAPI_dashboard = expenses?.byCategory["Дірект"] || expenses?.byCategory["Direct"] || 0;
  const directManual_dashboard = manualFields.direct || 0;
  const direct_dashboard = directFromAPI_dashboard > 0 ? directFromAPI_dashboard : directManual_dashboard;
  const taxesFromAPI_dashboard = expenses?.byCategory["Податки та збори"] || expenses?.byCategory["Taxes and fees"] || 0;
  const taxesExtraManual_dashboard = manualFields.taxes_extra || 0;
  const miscExpensesFromAPI_dashboard = expenses?.byCategory["Miscellaneous expenses"] || expenses?.byCategory["Інші витрати"] || 0;
  const deliveryFromAPI_dashboard = expenses?.byCategory["Доставка товарів (Нова Пошта)"] ||
                                   expenses?.byCategory["Доставка товарів (Каса Нова Пошта)"] ||
                                   expenses?.byCategory["Доставка товарів"] ||
                                   0;
  const consumablesFromAPI_dashboard = expenses?.byCategory["Consumables purchase"] || expenses?.byCategory["Закупівля матеріалів"] || 0;
  const stationeryFromAPI_dashboard = expenses?.byCategory["Канцелярські, миючі товари та засоби"] || 0;
  const productsForGuestsFromAPI_dashboard = expenses?.byCategory["Продукти для гостей"] || 0;
  const acquiringFromAPI_dashboard = expenses?.byCategory["Еквайринг"] || expenses?.byCategory["Acquiring"] || 0;
  const acquiringManual_dashboard = manualFields.acquiring || 0;
  const acquiring_dashboard = acquiringFromAPI_dashboard > 0 ? acquiringFromAPI_dashboard : acquiringManual_dashboard;
  const utilitiesFromAPI_dashboard = expenses?.byCategory["Інтернет, CRM і т д."] ||
                                   expenses?.byCategory["Інтеренет, CRM, IP і т. д."] ||
                                   expenses?.byCategory["Комунальні, Інтеренет, ІР і т. д."] ||
                                   expenses?.byCategory["Комунальні, Інтеренет, IP і т. д."] ||
                                   0;
  const salary_dashboard = salaryFromAPI_dashboard;
  const marketingTotal_dashboard = cmmFromAPI_dashboard + targetFromAPI_dashboard + advertisingFromAPI_dashboard + direct_dashboard;
  const taxes_dashboard = taxesFromAPI_dashboard + taxesExtraManual_dashboard;
  const otherExpensesTotal_dashboard = miscExpensesFromAPI_dashboard + deliveryFromAPI_dashboard + consumablesFromAPI_dashboard + stationeryFromAPI_dashboard + productsForGuestsFromAPI_dashboard + acquiring_dashboard + utilitiesFromAPI_dashboard;
  const expensesWithoutSalary_dashboard = rent_dashboard + marketingTotal_dashboard + taxes_dashboard + otherExpensesTotal_dashboard + accounting_dashboard;
  const totalExpensesDashboard = salary_dashboard + expensesWithoutSalary_dashboard;
  const profitDashboard = totalIncomeDashboard - totalExpensesDashboard;

  const displayMonthLabel = monthOptions.find((m) => m.month === selectedMonth)?.label || "";

  return (
    <div className="mx-auto max-w-6xl px-2 py-2 space-y-2">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Фінансовий звіт (Altegio)</h1>
          {summary && (
            <p className="text-xs text-gray-500">
              Період:{" "}
              {formatDateHuman(summary.range.date_from)} —{" "}
              {formatDateHuman(summary.range.date_to)}
            </p>
          )}
        </div>

        {/* Вибір місяця / року через GET-параметри */}
        <form
          className="flex flex-wrap items-center gap-2 text-sm"
          method="GET"
        >
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Місяць:</span>
            <select
              name="month"
              defaultValue={String(selectedMonth)}
              className="select select-bordered select-sm"
            >
              {monthOptions.map((opt) => (
                <option key={opt.month} value={opt.month}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Рік:</span>
            <select
              name="year"
              defaultValue={String(selectedYear)}
              className="select select-bordered select-sm"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-sm btn-primary">
            Показати
          </button>
        </form>
      </div>

      {error && (
        <div className="alert alert-error max-w-xl">
          <span>Помилка при зверненні до Altegio: {error}</span>
        </div>
      )}

      {summary && (
        <>
          {/* Компактний дашборд (як на прикладі) */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-2">
              <div className="overflow-x-auto">
                <table className="table table-xs">
                  <thead>
                    <tr className="bg-yellow-300">
                      <th className="text-center text-sm font-semibold" colSpan={2}>
                        {displayMonthLabel} {selectedYear}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-cyan-200">
                      <td className="font-medium">Оборот (Виручка)</td>
                      <td className="text-right text-base font-bold">{formatMoney(summary.totals.total)} грн.</td>
                    </tr>
                    <tr className="bg-rose-100">
                      <td className="font-medium">Собівартість товару</td>
                      <td className="text-right text-base font-bold">{formatMoney(goodsCostDashboard)} грн.</td>
                    </tr>
                    <tr className="bg-blue-200">
                      <td className="font-medium">Дохід (послуги+товар)</td>
                      <td className="text-right text-base font-bold text-blue-900">{formatMoney(totalIncomeDashboard)} грн.</td>
                    </tr>
                    <tr className="bg-red-200">
                      <td className="font-medium">Розхід</td>
                      <td className="text-right text-base font-bold text-red-800">{formatMoney(totalExpensesDashboard)} грн.</td>
                    </tr>
                    <tr className="bg-green-200">
                      <td className="font-medium">Прибуток салону</td>
                      <td className="text-right text-base font-bold text-green-900">{formatMoney(profitDashboard)} грн.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="grid gap-2 grid-cols-4">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-2">
                <p className="text-xs uppercase text-gray-500">Всього виручка</p>
                <p className="text-base font-semibold">
                  {formatMoney(summary.totals.total)} грн.
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-2">
                <p className="text-xs uppercase text-gray-500">Послуги</p>
                <p className="text-base font-semibold">
                  {formatMoney(summary.totals.services)} грн.
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-2">
                <p className="text-xs uppercase text-gray-500">Товари</p>
                <p className="text-base font-semibold">
                  {formatMoney(summary.totals.goods)} грн.
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-2">
                <p className="text-xs uppercase text-gray-500">Середній чек</p>
                <p className="text-base font-semibold">
                  {summary.totals.avgCheck != null
                    ? `${formatMoney(summary.totals.avgCheck)} грн.`
                    : "—"}
                </p>
              </div>
            </div>
          </section>

          {/* Товари: виручка / собівартість / націнка за місяць */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-2 space-y-1">
              <h2 className="card-title text-sm">Товари за місяць</h2>
              <div className="grid gap-2 grid-cols-3">
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Виручка по товарах
                  </p>
                  <p className="text-sm font-semibold">
                    {formatMoney(summary.totals.goods)} грн.
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Собівартість товарів
                  </p>
                  {goods ? (
                    <>
                      <EditCostButton
                        year={selectedYear}
                        month={selectedMonth}
                        currentCost={goods.cost}
                      />
                      {goods.totalItemsSold > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Всього продано: {goods.totalItemsSold.toLocaleString("uk-UA")} шт. ({goods.itemsCount} транзакцій)
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm font-semibold">— грн.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Націнка (дохід по товарах)
                  </p>
                  <p className="text-sm font-semibold">
                    {summary && goods
                      ? `${formatMoney(summary.totals.goods - goods.cost)} грн.`
                      : "— грн."}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Доходи */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-2 space-y-1">
              <h2 className="card-title text-sm">Доходи</h2>
              <div className="grid gap-2 grid-cols-3">
                <div>
                  <p className="text-xs uppercase text-gray-500">Послуги</p>
                  <p className="text-sm font-semibold">
                    {summary ? formatMoney(summary.totals.services) : "—"} грн.
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">Націнка (дохід по товарах)</p>
                  <p className="text-sm font-semibold">
                    {summary && goods
                      ? formatMoney(summary.totals.goods - goods.cost)
                      : "—"} грн.
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">Всього доходів</p>
                  <p className="text-sm font-semibold">
                    {summary && goods
                      ? formatMoney(summary.totals.services + (summary.totals.goods - goods.cost))
                      : "—"} грн.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Розходи за місяць */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-2 space-y-2">
              <h2 className="card-title text-sm">Розходи за місяць</h2>
              

              {/* Структура згідно з Excel */}
              {(() => {
                // Отримуємо дані з API
                const encashment = expenses?.byCategory["Інкасація"] || expenses?.byCategory["Инкасація"] || 0;
                const management = expenses?.byCategory["Управління"] || expenses?.byCategory["Управление"] || 0;
                const productPurchase = expenses?.byCategory["Product purchase"] || 0;
                const investments = expenses?.byCategory["Інвестиції в салон"] || expenses?.byCategory["Инвестиции в салон"] || 0;
                const salaryFromAPI = expenses?.byCategory["Зарплата співробітникам"] || expenses?.byCategory["Team salaries"] || 0;
                const rentFromAPI = expenses?.byCategory["Оренда"] || expenses?.byCategory["Rent"] || 0;
                const rentManual = manualFields.rent || 0; // Fallback, якщо немає в API
                const rent = rentFromAPI > 0 ? rentFromAPI : rentManual; // Використовуємо API, якщо є
                const accountingFromAPI = expenses?.byCategory["Бухгалтерія"] || expenses?.byCategory["Accounting"] || 0;
                const accountingManual = manualFields.accounting || 0; // Fallback, якщо немає в API
                const accounting = accountingFromAPI > 0 ? accountingFromAPI : accountingManual; // Використовуємо API, якщо є
                const cmmFromAPI = expenses?.byCategory["Маркетинг"] || expenses?.byCategory["Marketing"] || 0;
                const targetFromAPI = expenses?.byCategory["Таргет оплата роботи маркетологів"] || 0;
                const advertisingFromAPI = expenses?.byCategory["Реклама, Бюджет, ФБ"] || 0;
                const directFromAPI = expenses?.byCategory["Дірект"] || expenses?.byCategory["Direct"] || 0;
                const directManual = manualFields.direct || 0; // Fallback, якщо немає в API
                const direct = directFromAPI > 0 ? directFromAPI : directManual; // Використовуємо API, якщо є
                const taxesFromAPI = expenses?.byCategory["Податки та збори"] || expenses?.byCategory["Taxes and fees"] || 0;
                const taxesExtraManual = manualFields.taxes_extra || 0;
                const miscExpensesFromAPI = expenses?.byCategory["Miscellaneous expenses"] || expenses?.byCategory["Інші витрати"] || 0;
                const deliveryFromAPI = expenses?.byCategory["Доставка товарів (Нова Пошта)"] || 
                                       expenses?.byCategory["Доставка товарів (Каса Нова Пошта)"] ||
                                       expenses?.byCategory["Доставка товарів"] ||
                                       0;
                const consumablesFromAPI = expenses?.byCategory["Consumables purchase"] || expenses?.byCategory["Закупівля матеріалів"] || 0;
                const stationeryFromAPI = expenses?.byCategory["Канцелярські, миючі товари та засоби"] || 0;
                const productsForGuestsFromAPI = expenses?.byCategory["Продукти для гостей"] || 0;
                const acquiringFromAPI = expenses?.byCategory["Еквайринг"] || expenses?.byCategory["Acquiring"] || 0;
                const acquiringManual = manualFields.acquiring || 0; // Fallback, якщо немає в API
                const acquiring = acquiringFromAPI > 0 ? acquiringFromAPI : acquiringManual; // Використовуємо API, якщо є
                const utilitiesFromAPI = expenses?.byCategory["Інтернет, CRM і т д."] ||
                                       expenses?.byCategory["Інтеренет, CRM, IP і т. д."] ||
                                       expenses?.byCategory["Комунальні, Інтеренет, ІР і т. д."] || 
                                       expenses?.byCategory["Комунальні, Інтеренет, IP і т. д."] ||
                                       0;

                // Обчислюємо суми
                const salary = salaryFromAPI; // Тільки з API, без ручного введення
                const marketingTotal = cmmFromAPI + targetFromAPI + advertisingFromAPI + direct; // Без бухгалтерії, використовуємо direct з API або fallback
                const taxes = taxesFromAPI + taxesExtraManual; // Податки з API + додаткові ручні
                const otherExpensesTotal = miscExpensesFromAPI + deliveryFromAPI + consumablesFromAPI + stationeryFromAPI + productsForGuestsFromAPI + acquiring + utilitiesFromAPI;
                
                // Розхід без ЗП (постійні витрати) - виключаємо інвестиції та закуплений товар (вони в Інкасації)
                const expensesWithoutSalary = rent + marketingTotal + taxes + otherExpensesTotal + accounting;
                
                // Загальний розхід
                const totalExpenses = salary + expensesWithoutSalary;

                return (
                  <div className="space-y-1">
                    {/* Розхід без ЗП (постійні) */}
                    <div className="flex justify-between items-center p-1 bg-gray-50 rounded text-xs">
                      <span className="text-sm font-medium text-gray-700">
                        Розхід без ЗП (постійні)
                      </span>
                      <span className="text-sm font-semibold">
                        {formatMoney(expensesWithoutSalary)} грн.
                      </span>
                    </div>

                    {/* Загальний розхід (червоний фон) */}
                    <div className="flex justify-between items-center p-2 bg-red-100 border-2 border-red-300 rounded">
                      <span className="text-base font-bold text-red-800">
                        Розхід
                      </span>
                      <span className="text-lg font-bold text-red-800">
                        {formatMoney(totalExpenses)} грн.
                      </span>
                    </div>

                    {/* ЗП */}
                    <div className="flex justify-between items-center p-2 border-b">
                      <span className="text-sm font-medium text-gray-700">
                        ЗП
                      </span>
                      <span className="text-sm font-semibold">
                        {formatMoney(salary)} грн.
                      </span>
                    </div>

                    {/* Оренда */}
                    {rent > 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <span className="text-sm font-medium text-gray-700">
                          Оренда
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(rent)} грн.
                        </span>
                      </div>
                    )}
                    {rent === 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            Оренда
                          </span>
                          <EditExpenseField
                            year={selectedYear}
                            month={selectedMonth}
                            fieldKey="rent"
                            label="Оренда"
                            currentValue={rentManual}
                          />
                        </div>
                        <span className="text-sm font-semibold">
                          {formatMoney(rentManual)} грн.
                        </span>
                      </div>
                    )}

                    {/* Marketing/Advertising Group */}
                    <div className="p-3 bg-gray-50 rounded border">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-gray-700">
                          Marketing/Advertising
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(marketingTotal)} грн.
                        </span>
                      </div>
                      <div className="space-y-1 ml-2">
                        {cmmFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">CMM</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(cmmFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {targetFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Таргет (ведення)</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(targetFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {advertisingFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Реклама бюджет ФБ</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(advertisingFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {direct > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Дірект</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(direct)} грн.
                            </span>
                          </div>
                        )}
                        {direct === 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Дірект</span>
                            <div className="flex items-center gap-1">
                              <EditExpenseField
                                year={selectedYear}
                                month={selectedMonth}
                                fieldKey="direct"
                                label="Дірект"
                                currentValue={directManual}
                              />
                              <span className="text-xs font-semibold">
                                {formatMoney(directManual)} грн.
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Other Expenses Group */}
                    <div className="p-3 bg-gray-50 rounded border">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-gray-700">
                          Інші витрати
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(otherExpensesTotal)} грн.
                        </span>
                      </div>
                      <div className="space-y-1 ml-2">
                        {miscExpensesFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Інші витрати</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(miscExpensesFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {deliveryFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Доставка товарів</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(deliveryFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {consumablesFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Закупівля матеріалів</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(consumablesFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {stationeryFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Канцелярські, миючі т</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(stationeryFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {productsForGuestsFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Продукти для гостей</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(productsForGuestsFromAPI)} грн.
                            </span>
                          </div>
                        )}
                        {acquiring > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Еквайринг</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(acquiring)} грн.
                            </span>
                          </div>
                        )}
                        {acquiring === 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Еквайринг</span>
                            <div className="flex items-center gap-1">
                              <EditExpenseField
                                year={selectedYear}
                                month={selectedMonth}
                                fieldKey="acquiring"
                                label="Еквайринг"
                                currentValue={acquiringManual}
                              />
                              <span className="text-xs font-semibold">
                                {formatMoney(acquiringManual)} грн.
                              </span>
                            </div>
                          </div>
                        )}
                        {utilitiesFromAPI > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">Інтернет, CRM і т д.</span>
                            <span className="text-xs font-semibold">
                              {formatMoney(utilitiesFromAPI)} грн.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Бухгалтерія */}
                    {accounting > 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <span className="text-sm font-medium text-gray-700">
                          Бухгалтерія
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(accounting)} грн.
                        </span>
                      </div>
                    )}
                    {accounting === 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            Бухгалтерія
                          </span>
                          <EditExpenseField
                            year={selectedYear}
                            month={selectedMonth}
                            fieldKey="accounting"
                            label="Бухгалтерія"
                            currentValue={accountingManual}
                          />
                        </div>
                        <span className="text-sm font-semibold">
                          {formatMoney(accountingManual)} грн.
                        </span>
                      </div>
                    )}

                    {/* Управління */}
                    {management > 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <span className="text-sm font-medium text-gray-700">
                          Управління
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(management)} грн.
                        </span>
                      </div>
                    )}

                    {/* Закуплено товару */}
                    {productPurchase > 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <span className="text-sm font-medium text-gray-700">
                          Закуплено товару
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(productPurchase)} грн.
                        </span>
                      </div>
                    )}

                    {/* Інвестиції в салон */}
                    {investments > 0 && (
                      <div className="flex justify-between items-center p-2 border-b">
                        <span className="text-sm font-medium text-gray-700">
                          Інвестиції в салон
                        </span>
                        <span className="text-sm font-semibold">
                          {formatMoney(investments)} грн.
                        </span>
                      </div>
                    )}

                    {/* Податки */}
                    <div className="flex justify-between items-center p-2 border-b">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">
                          Податки
                        </span>
                        {taxesFromAPI === 0 && (
                          <EditExpenseField
                            year={selectedYear}
                            month={selectedMonth}
                            fieldKey="taxes_extra"
                            label="Податки (додатково)"
                            currentValue={taxesExtraManual}
                          />
                        )}
                        {taxesFromAPI > 0 && taxesExtraManual > 0 && (
                          <EditExpenseField
                            year={selectedYear}
                            month={selectedMonth}
                            fieldKey="taxes_extra"
                            label="Податки (додатково)"
                            currentValue={taxesExtraManual}
                          />
                        )}
                      </div>
                      <span className="text-sm font-semibold">
                        {formatMoney(taxes)} грн.
                      </span>
                    </div>

                    {/* Інкасація */}
                    {encashment > 0 && (
                      <div className="mt-4 p-4 bg-blue-50 rounded border border-blue-200">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">
                          Інкасація
                        </h3>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">
                              Інкасація
                            </span>
                            <span className="text-sm font-semibold">
                              {formatMoney(encashment)} грн.
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-2 border-t border-blue-300">
                            <span className="text-sm font-medium text-gray-700">
                              Всього інкасації
                            </span>
                            <span className="text-sm font-semibold">
                              {formatMoney(encashment)} грн.
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </section>

          {/* Прибуток */}
          {(() => {
            // Розраховуємо Доходи
            const services = summary?.totals.services || 0;
            const markup = summary && goods ? (summary.totals.goods - goods.cost) : 0;
            const totalIncome = services + markup;

            // Розраховуємо Розходи (використовуємо ту саму логіку, що й в блоці "Розходи")
            const encashment = expenses?.byCategory["Інкасація"] || expenses?.byCategory["Инкасація"] || 0;
            const management = expenses?.byCategory["Управління"] || expenses?.byCategory["Управление"] || 0;
            const productPurchase = expenses?.byCategory["Product purchase"] || 0;
            const investments = expenses?.byCategory["Інвестиції в салон"] || expenses?.byCategory["Инвестиции в салон"] || 0;
            const salaryFromAPI = expenses?.byCategory["Зарплата співробітникам"] || expenses?.byCategory["Team salaries"] || 0;
            const rentFromAPI = expenses?.byCategory["Оренда"] || expenses?.byCategory["Rent"] || 0;
            const rentManual = manualFields.rent || 0;
            const rent = rentFromAPI > 0 ? rentFromAPI : rentManual;
            const accountingFromAPI = expenses?.byCategory["Бухгалтерія"] || expenses?.byCategory["Accounting"] || 0;
            const accountingManual = manualFields.accounting || 0;
            const accounting = accountingFromAPI > 0 ? accountingFromAPI : accountingManual;
            const cmmFromAPI = expenses?.byCategory["Маркетинг"] || expenses?.byCategory["Marketing"] || 0;
            const targetFromAPI = expenses?.byCategory["Таргет оплата роботи маркетологів"] || 0;
            const advertisingFromAPI = expenses?.byCategory["Реклама, Бюджет, ФБ"] || 0;
            const directFromAPI = expenses?.byCategory["Дірект"] || expenses?.byCategory["Direct"] || 0;
            const directManual = manualFields.direct || 0;
            const direct = directFromAPI > 0 ? directFromAPI : directManual;
            const taxesFromAPI = expenses?.byCategory["Податки та збори"] || expenses?.byCategory["Taxes and fees"] || 0;
            const taxesExtraManual = manualFields.taxes_extra || 0;
            const miscExpensesFromAPI = expenses?.byCategory["Miscellaneous expenses"] || expenses?.byCategory["Інші витрати"] || 0;
            const deliveryFromAPI = expenses?.byCategory["Доставка товарів (Нова Пошта)"] || 
                                   expenses?.byCategory["Доставка товарів (Каса Нова Пошта)"] ||
                                   expenses?.byCategory["Доставка товарів"] ||
                                   0;
            const consumablesFromAPI = expenses?.byCategory["Consumables purchase"] || expenses?.byCategory["Закупівля матеріалів"] || 0;
            const stationeryFromAPI = expenses?.byCategory["Канцелярські, миючі товари та засоби"] || 0;
            const productsForGuestsFromAPI = expenses?.byCategory["Продукти для гостей"] || 0;
            const acquiringFromAPI = expenses?.byCategory["Еквайринг"] || expenses?.byCategory["Acquiring"] || 0;
            const acquiringManual = manualFields.acquiring || 0;
            const acquiring = acquiringFromAPI > 0 ? acquiringFromAPI : acquiringManual;
            const utilitiesFromAPI = expenses?.byCategory["Інтернет, CRM і т д."] ||
                                   expenses?.byCategory["Інтеренет, CRM, IP і т. д."] ||
                                   expenses?.byCategory["Комунальні, Інтеренет, ІР і т. д."] || 
                                   expenses?.byCategory["Комунальні, Інтеренет, IP і т. д."] ||
                                   0;

            const salary = salaryFromAPI;
            const marketingTotal = cmmFromAPI + targetFromAPI + advertisingFromAPI + direct;
            const taxes = taxesFromAPI + taxesExtraManual;
            const otherExpensesTotal = miscExpensesFromAPI + deliveryFromAPI + consumablesFromAPI + stationeryFromAPI + productsForGuestsFromAPI + acquiring + utilitiesFromAPI;
            const expensesWithoutSalary = rent + marketingTotal + taxes + otherExpensesTotal + accounting;
            const totalExpenses = salary + expensesWithoutSalary;

            // Розраховуємо Прибуток
            const profit = totalIncome - totalExpenses;
            
            // Розраховуємо Чистий прибуток власника (Прибуток - Управління)
            const ownerProfitLocal = profit - management;
            
            // Отримуємо компоненти для інкасації локально (щоб використовувати ті самі значення, що в формулі)
            const costLocal = goods?.cost || 0;
            const productPurchaseLocal = expenses?.byCategory["Product purchase"] || 
                                       expenses?.byCategory["Закуплено товару"] || 
                                       expenses?.byCategory["Закуплений товар"] || 
                                       0;
            const investmentsLocal = expenses?.byCategory["Інвестиції в салон"] || 
                                   expenses?.byCategory["Инвестиции в салон"] || 
                                   expenses?.byCategory["Інвестиції"] ||
                                   0;
            
            // Знаходимо всі платежі з ФОП Ореховська локально
            let fopOrekhovskaPaymentsLocal = 0;
            if (expenses?.transactions && Array.isArray(expenses.transactions)) {
              fopOrekhovskaPaymentsLocal = expenses.transactions
                .filter((t: any) => {
                  const accountTitle = (t.account?.title || "").toLowerCase();
                  const accountName = (t.account?.name || "").toLowerCase();
                  const comment = (t.comment || "").toLowerCase();
                  const expenseTitle = ((t.expense?.title || t.expense?.name) || "").toLowerCase();
                  
                  if (accountTitle.includes("фоп ореховська") || accountTitle.includes("фоп ореховская") || 
                      accountTitle.includes("ореховська") || accountTitle.includes("ореховская")) {
                    return true;
                  }
                  
                  const searchText = (accountName + " " + comment + " " + expenseTitle);
                  return searchText.includes("ореховська") || searchText.includes("ореховская") || 
                         searchText.includes("фоп ореховська") || searchText.includes("фоп ореховская");
                })
                .reduce((sum: number, t: any) => {
                  const amount = Math.abs(Number(t.amount) || 0);
                  return sum + amount;
                }, 0);
            }
            
            // Перераховуємо інкасацію використовуючи локальні значення
            const encashmentLocal = costLocal + ownerProfitLocal - productPurchaseLocal - investmentsLocal + fopOrekhovskaPaymentsLocal;
            
            // Логуємо для діагностики
            console.log(`[finance-report] 📊 Інкасація локальний розрахунок:`, {
              costLocal,
              ownerProfitLocal,
              productPurchaseLocal,
              investmentsLocal,
              fopOrekhovskaPaymentsLocal,
              calculation: `${costLocal} + ${ownerProfitLocal} - ${productPurchaseLocal} - ${investmentsLocal} + ${fopOrekhovskaPaymentsLocal}`,
              expected: costLocal + ownerProfitLocal - productPurchaseLocal - investmentsLocal + fopOrekhovskaPaymentsLocal,
              actual: encashmentLocal,
            });
            
            // Розраховуємо в доларах (якщо курс встановлено)
            const profitUSD = exchangeRate > 0 ? profit / exchangeRate : 0;
            const ownerProfitUSD = exchangeRate > 0 ? ownerProfitLocal / exchangeRate : 0;

            return (
              <section className="card bg-base-100 shadow-sm">
                <div className="card-body p-2 space-y-2">
                  <h2 className="card-title text-sm">Прибуток</h2>
                  
                  {/* Курс долара */}
                  <div className="flex items-center gap-2 pb-3 border-b">
                    <span className="text-sm font-medium text-gray-700">
                      Курс долара:
                    </span>
                    <EditExchangeRateField
                      year={selectedYear}
                      month={selectedMonth}
                      currentRate={exchangeRate || 0}
                    />
                  </div>
                  
                  <div className="grid gap-2 grid-cols-3">
                    <div>
                      <p className="text-xs uppercase text-gray-500">
                        Доходи
                      </p>
                      <p className="text-lg font-semibold md:text-xl">
                        {formatMoney(totalIncome)} грн.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-gray-500">
                        Розходи
                      </p>
                      <p className="text-lg font-semibold md:text-xl">
                        {formatMoney(totalExpenses)} грн.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-gray-500">
                        Прибуток
                      </p>
                      <p className={`text-lg font-semibold md:text-xl ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatMoney(profit)} грн.
                      </p>
                      {exchangeRate > 0 && (
                        <p className="text-sm text-gray-500 mt-1">
                          ≈ ${profitUSD.toFixed(2)} USD
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* Чистий прибуток власника */}
                  <div className="pt-3 border-t">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs uppercase text-gray-500">
                          Чистий прибуток власника
                        </p>
                        <p className="text-sm text-gray-400">
                          (Прибуток - Управління)
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-semibold md:text-xl ${ownerProfitLocal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatMoney(ownerProfitLocal)} грн.
                        </p>
                        {exchangeRate > 0 && (
                          <p className="text-sm text-gray-500 mt-1">
                            ≈ ${ownerProfitUSD.toFixed(2)} USD
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Баланс складу */}
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <p className="text-xs uppercase text-gray-500">Баланс складу</p>
                        <p className="text-xs text-gray-400">(на {formatDateHuman(monthRange(selectedYear, selectedMonth).to)})</p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold">{formatMoney(warehouseBalance)} грн.</p>
                        <EditWarehouseBalanceButton
                          year={selectedYear}
                          month={selectedMonth}
                          currentBalance={warehouseBalance}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Різниця балансу складу */}
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs uppercase text-gray-500">Різниця</p>
                        <p className="text-xs text-gray-400">{warehouseBalanceDiff >= 0 ? "Склад збільшився" : "Склад зменшився"}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-base font-semibold ${warehouseBalanceDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {warehouseBalanceDiff >= 0 ? '+' : ''}{formatMoney(warehouseBalanceDiff)} грн.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Потрібно закупити волосся */}
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-center">
                      <p className="text-xs uppercase text-gray-500">Потрібно закупити волосся на суму</p>
                      <p className="text-base font-semibold">{formatMoney(hairPurchaseAmount)} грн.</p>
                    </div>
                  </div>
                  
                  {/* Платежі з ФОП Ореховська */}
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-center">
                      <p className="text-xs uppercase text-gray-500">Платежі з ФОП Ореховська</p>
                      <p className="text-base font-semibold">{formatMoney(fopOrekhovskaPayments)} грн.</p>
                    </div>
                  </div>
                  
                  {/* Інкасація */}
                  <div className="pt-2 border-t">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="text-xs uppercase text-gray-500">Інкасація</p>
                        <div className="text-xs text-gray-400 mt-0.5 space-y-0.5">
                          <p>Собівартість {formatMoney(costLocal)} грн.</p>
                          <p>+ Чистий прибуток власника {formatMoney(ownerProfitLocal)} грн.</p>
                          <p>- Закуплений товар {formatMoney(productPurchaseLocal)} грн.</p>
                          <p>- Інвестиції {formatMoney(investmentsLocal)} грн.</p>
                          <p>+ Платежі з ФОП Ореховська {formatMoney(fopOrekhovskaPaymentsLocal)} грн.</p>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <p className={`text-base font-semibold ${encashmentLocal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatMoney(encashmentLocal)} грн.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Ручні поля */}
                  <div className="pt-2 border-t space-y-2">
                    <h3 className="text-xs uppercase text-gray-500 font-semibold">Ручні поля</h3>
                    
                    {/* Кількість Консультацій */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-700">Кількість Консультацій</span>
                        <EditNumberField
                          year={selectedYear}
                          month={selectedMonth}
                          fieldKey="consultations_count"
                          label="Кількість Консультацій"
                          currentValue={manualFields.consultations_count || 0}
                          unit="шт."
                        />
                      </div>
                      <p className="text-xs font-semibold">{formatMoney(manualFields.consultations_count || 0)} шт.</p>
                    </div>
                    
                    {/* Нових платних клієнтів */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-700">Нових платних клієнтів</span>
                        <EditNumberField
                          year={selectedYear}
                          month={selectedMonth}
                          fieldKey="new_paid_clients"
                          label="Нових платних клієнтів"
                          currentValue={manualFields.new_paid_clients || 0}
                          unit="шт."
                        />
                      </div>
                      <p className="text-xs font-semibold">{formatMoney(manualFields.new_paid_clients || 0)} шт.</p>
                    </div>
                    
                    {/* Вартість 1-го нового клієнта (автоматичне поле) */}
                    {(() => {
                      const cmmFromAPI = expenses?.byCategory["Маркетинг"] || expenses?.byCategory["Marketing"] || 0;
                      const targetFromAPI = expenses?.byCategory["Таргет оплата роботи маркетологів"] || 0;
                      const advertisingFromAPI = expenses?.byCategory["Реклама, Бюджет, ФБ"] || 0;
                      const directFromAPI = expenses?.byCategory["Дірект"] || expenses?.byCategory["Direct"] || 0;
                      const directManual = manualFields.direct || 0;
                      const direct = directFromAPI > 0 ? directFromAPI : directManual;
                      const marketingTotal = cmmFromAPI + targetFromAPI + advertisingFromAPI + direct;
                      const newPaidClients = manualFields.new_paid_clients || 0;
                      const costPerClient = newPaidClients > 0 ? marketingTotal / newPaidClients : 0;
                      
                      return (
                        <div className="flex justify-between items-center pt-1 border-t">
                          <div>
                            <p className="text-xs text-gray-700">Вартість 1-го нового клієнта</p>
                            <p className="text-xs text-gray-400">(Маркетинг {formatMoney(marketingTotal)} грн. / {newPaidClients} шт.)</p>
                          </div>
                          <p className="text-xs font-semibold">{formatMoney(costPerClient)} грн.</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </section>
            );
          })()}

          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-2">
              <CollapsibleSection
                title="Динаміка виручки по днях"
                summary={
                  <p className="text-xs text-gray-600">
                    Разом:{" "}
                    <span className="font-semibold">
                      {formatMoney(
                        summary.incomeDaily.reduce(
                          (sum, row) => sum + (row.value || 0),
                          0,
                        ),
                      )}{" "}
                      грн.
                    </span>
                  </p>
                }
                defaultCollapsed={true}
              >
                {summary.incomeDaily.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Немає даних про виручку по днях за вибраний період.
                  </p>
                ) : (
                  <div className="overflow-x-auto mt-2">
                    <table className="table table-xs">
                      <thead>
                        <tr>
                          <th className="text-xs">Дата</th>
                          <th className="text-right text-xs">Виручка, грн.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.incomeDaily.map((row) => (
                          <tr key={row.date}>
                            <td className="text-xs">{formatDateHuman(row.date)}</td>
                            <td className="text-right text-xs">
                              {formatMoney(row.value)} грн.
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleSection>
            </div>
          </section>
        </>
      )}
    </div>
  );
}


