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
import { CollapsibleGroup } from "./_components/CollapsibleGroup";
import { EditableCostCell } from "./_components/EditableCostCell";
import { getWarehouseBalance } from "@/lib/altegio";
import { unstable_noStore as noStore } from "next/cache";
import { FinanceReportClient } from "./FinanceReportClient";
import { FinanceReportPageClient } from "./FinanceReportPageClient";

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

  const summaryContent = summary ? (
    <FinanceReportClient>
      {{
        block1: (
            <section className="card bg-base-100 shadow-sm relative h-full">
              <div className="drag-handle absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold z-10 cursor-move">1</div>
              <div className="card-body p-1.5">
                <table className="table table-xs w-full border-collapse">
                  <colgroup>
                    <col className="w-auto" />
                    <col className="w-40" />
                    <col className="w-20" />
                  </colgroup>
                  <thead>
                    <tr className="bg-yellow-300">
                      <th className="text-center text-xs font-semibold px-2 py-1" colSpan={3}>
                        Листопад 2025
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-2 py-1 text-xs bg-blue-50">Оборот (Виручка)</td>
                      <td className="px-2 py-1 text-xs text-right font-semibold">{formatMoney(summary.totals.total)}</td>
                      <td className="px-2 py-1 text-xs text-right">100.0%</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-xs pl-4">Послуги</td>
                      <td className="px-2 py-1 text-xs text-right">{formatMoney(summary.totals.services)}</td>
                      <td className="px-2 py-1 text-xs text-right">{((summary.totals.services / summary.totals.total) * 100).toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-xs pl-4">Товари</td>
                      <td className="px-2 py-1 text-xs text-right">{formatMoney(summary.totals.goods)}</td>
                      <td className="px-2 py-1 text-xs text-right">{((summary.totals.goods / summary.totals.total) * 100).toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-xs bg-red-50">
                        <EditableCostCell
                          label="Собівартість товару"
                          value={costOfGoodsSold}
                          onSave={handleCostSave}
                        />
                      </td>
                      <td className="px-2 py-1 text-xs text-right font-semibold">{formatMoney(costOfGoodsSold)}</td>
                      <td className="px-2 py-1 text-xs text-right">{((costOfGoodsSold / summary.totals.total) * 100).toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-xs bg-blue-50">Дохід (послуги+товар)</td>
                      <td className="px-2 py-1 text-xs text-right font-semibold">{formatMoney(totalIncome)}</td>
                      <td className="px-2 py-1 text-xs text-right">{((totalIncome / summary.totals.total) * 100).toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-xs bg-red-50">Розхід</td>
                      <td className="px-2 py-1 text-xs text-right font-semibold">{formatMoney(totalExpenses)}</td>
                      <td className="px-2 py-1 text-xs text-right">{((totalExpenses / summary.totals.total) * 100).toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-xs bg-green-50 font-semibold">Прибуток салону</td>
                      <td className="px-2 py-1 text-xs text-right font-bold">{formatMoney(profit)}</td>
                      <td className="px-2 py-1 text-xs text-right font-semibold">{((profit / summary.totals.total) * 100).toFixed(1)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
              ),
              block2: (
            <section className="card bg-base-100 shadow-sm relative h-full">
              <div className="drag-handle absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold z-10 cursor-move">2</div>
              <div className="card-body p-1.5">
                <h3 className="text-xs font-semibold mb-2">Прибуток</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center bg-blue-50 p-1 rounded">
                    <span>Курс долара</span>
                    <EditExchangeRateField
                      value={exchangeRate}
                      onSave={handleExchangeRateSave}
                    />
                  </div>
                  <div className="flex justify-between items-center p-1">
                    <span>Баланс складу</span>
                    <EditWarehouseBalanceButton
                      value={warehouseBalance}
                      date={summary.range.date_to}
                      onSave={handleWarehouseBalanceSave}
                    />
                  </div>
                  <div className="flex justify-between items-center bg-green-50 p-1 rounded">
                    <span>Різниця</span>
                    <span className="font-semibold">{formatMoney(warehouseDifference)}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-xs font-semibold mb-1">РУЧНІ ПОЛЯ</div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center p-1">
                        <span>Кількість Консультацій</span>
                        <EditNumberField
                          value={manualFields.consultations}
                          onSave={(v) => handleManualFieldSave("consultations", v)}
                        />
                      </div>
                      <div className="flex justify-between items-center p-1">
                        <span>Нових платних клієнтів</span>
                        <EditNumberField
                          value={manualFields.newClients}
                          onSave={(v) => handleManualFieldSave("newClients", v)}
                        />
                      </div>
                      <div className="flex justify-between items-center p-1">
                        <span>Вартість 1-го нового клієнта</span>
                        <span className="font-semibold">{formatMoney(manualFields.newClients > 0 ? marketingTotal / manualFields.newClients : 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
              ),
              block3: (
            <section className="card bg-base-100 shadow-sm relative h-full">
              <div className="drag-handle absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold z-10 cursor-move">3</div>
              <div className="card-body p-1.5">
                <h3 className="text-xs font-semibold mb-2">Розходи за місяць</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center bg-red-50 p-1 rounded">
                    <span className="font-semibold">Розхід</span>
                    <span className="font-bold">{formatMoney(totalExpenses)}</span>
                  </div>
                  <CollapsibleSection title="ЗП та Оренда" amount={salaryAndRent} />
                  <CollapsibleSection title="Marketing/Advertising" amount={marketingTotal} />
                  <CollapsibleSection title="Інші витрати" amount={otherExpensesTotal} />
                  <CollapsibleSection title="Бухгалтерія та податки" amount={taxesTotal} />
                </div>
              </div>
            </section>
              ),
              block4: (
            <section className="card bg-base-100 shadow-sm relative h-full">
              <div className="drag-handle absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold z-10 cursor-move">4</div>
              <div className="card-body p-1.5">
                <h3 className="text-xs font-semibold mb-2">Управління та інвестиції</h3>
                <div className="space-y-1 text-xs">
                  <CollapsibleSection title="Управління та інвестиції" amount={managementAndInvestments} />
                  <div className="flex justify-between items-center bg-green-50 p-1 rounded mt-2">
                    <span className="font-semibold">Чистий прибуток власника</span>
                    <span className="font-bold">{formatMoney(ownerNetProfit)} ({formatMoney(ownerNetProfitUSD)})</span>
                  </div>
                  <div className="flex justify-between items-center p-1 mt-2">
                    <span>Потрібно закупити волосся на суму</span>
                    <span className="font-semibold">{formatMoney(hairPurchaseNeeded)}</span>
                  </div>
                  <CollapsibleSection title="Інкасація" amount={collection} />
                </div>
              </div>
            </section>
              ),
              block5: (
            <section className="card bg-base-100 shadow-sm relative h-full">
              <div className="drag-handle absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold z-10 cursor-move">5</div>
              <div className="card-body p-1.5">
                <h3 className="text-xs font-semibold mb-2">Деталізація розходів</h3>
                <div className="space-y-1 text-xs">
                  <CollapsibleGroup title="ЗП та Оренда" amount={salaryAndRent}>
                    <CollapsibleSection title="ЗП" amount={salary} />
                    <CollapsibleSection title="Оренда" amount={rent} />
                  </CollapsibleGroup>
                  <CollapsibleGroup title="Marketing/Advertising" amount={marketingTotal}>
                    <CollapsibleSection title="CMM" amount={cmm} />
                    <CollapsibleSection title="Target" amount={target} />
                    <CollapsibleSection title="Advertising" amount={advertising} />
                    <CollapsibleSection title="Direct" amount={direct} />
                  </CollapsibleGroup>
                  <CollapsibleGroup title="Інші витрати" amount={otherExpensesTotal}>
                    <CollapsibleSection title="Misc Expenses" amount={miscExpenses} />
                    <CollapsibleSection title="Delivery" amount={delivery} />
                    <CollapsibleSection title="Consumables" amount={consumables} />
                    <CollapsibleSection title="Stationery" amount={stationery} />
                    <CollapsibleSection title="Products for Guests" amount={productsForGuests} />
                    <CollapsibleSection title="Acquiring" amount={acquiring} />
                    <CollapsibleSection title="Utilities" amount={utilities} />
                  </CollapsibleGroup>
                  <CollapsibleGroup title="Бухгалтерія та податки" amount={taxesTotal}>
                    <CollapsibleSection title="Taxes" amount={taxes} />
                    <CollapsibleSection title="Taxes Extra Manual" amount={taxesExtraManual} />
                  </CollapsibleGroup>
                  <CollapsibleGroup title="Управління та інвестиції" amount={managementAndInvestments}>
                    <CollapsibleSection title="Management" amount={management} />
                    <CollapsibleSection title="Investments" amount={investments} />
                  </CollapsibleGroup>
                  <CollapsibleSection title="Інкасація" amount={collection} />
                </div>
              </div>
            </section>
              ),
            }}
          </FinanceReportClient>
        ) : null;

  return (
    <FinanceReportPageClient summaryContent={summaryContent}>
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
    </FinanceReportPageClient>
  );
}
