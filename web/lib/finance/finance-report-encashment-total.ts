// Розрахунок суми з рядка «Інкасація» у фінзвіті (для Telegram та API).

import {
  fetchFinanceSummary,
  fetchGoodsSalesSummary,
  fetchExpensesSummary,
  type ExpensesSummary,
} from "@/lib/altegio";
import { getDepositsAttributedToMonth } from "@/lib/altegio/deposit-attribution";
import { fetchFinanceReportDiscountTotal } from "@/lib/finance/finance-report-discounts";

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: formatDateISO(from), to: formatDateISO(to) };
}

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
          const value = (parsed as { value?: unknown })?.value ?? parsed;
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
    console.error(`[finance-report-encashment-total] KV ${fieldKey}:`, err);
  }
  return 0;
}

function getTerminalExpenseFromApi(expenses: ExpensesSummary | null | undefined): number {
  const bc = expenses?.byCategory;
  if (!bc) return 0;
  return bc["Термінал"] || bc["ТЕРМІНАЛ"] || bc["Terminal"] || 0;
}

function getHospodarskiMiscExpense(expenses: ExpensesSummary | null | undefined): number {
  return expenses?.byCategory?.["Miscellaneous expenses"] || 0;
}

function sumFopOrekhovskaPayments(expenses: ExpensesSummary | null | undefined): number {
  if (!expenses?.transactions || !Array.isArray(expenses.transactions)) return 0;

  return expenses.transactions
    .filter((t) => {
      const accountTitle = (t.account?.title || "").toLowerCase();
      const accountName = (t.account?.name || "").toLowerCase();
      const comment = (t.comment || "").toLowerCase();
      const expenseTitle = ((t.expense?.title || t.expense?.name) || "").toLowerCase();

      if (
        accountTitle.includes("фоп ореховська") ||
        accountTitle.includes("фоп ореховская") ||
        accountTitle.includes("ореховська") ||
        accountTitle.includes("ореховская")
      ) {
        return true;
      }

      const searchText = `${accountName} ${comment} ${expenseTitle}`;
      return (
        searchText.includes("ореховська") ||
        searchText.includes("ореховская") ||
        searchText.includes("фоп ореховська") ||
        searchText.includes("фоп ореховская")
      );
    })
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
}

/** Сума з рядка «Інкасація» у фінзвіті за місяць. */
export async function getFinanceReportEncashmentTotalUah(
  year: number,
  month: number,
): Promise<number> {
  const { from, to } = monthRange(year, month);

  const manualFieldKeys = ["rent", "accounting", "direct", "taxes_extra", "acquiring"] as const;
  const manualFields = Object.fromEntries(
    await Promise.all(
      manualFieldKeys.map(async (fieldKey) => [
        fieldKey,
        await getManualExpenseField(year, month, fieldKey),
      ]),
    ),
  ) as Record<(typeof manualFieldKeys)[number], number>;

  const summary = await fetchFinanceSummary({ date_from: from, date_to: to });
  const [goods, expenses, discountAmount, depositsAttributed] = await Promise.all([
    fetchGoodsSalesSummary({
      date_from: from,
      date_to: to,
      salonGoodsRevenueUah: summary.totals?.goods,
      incomeGoodsStatsExtras: summary.incomeGoodsStatsExtras,
    }),
    fetchExpensesSummary({ date_from: from, date_to: to }),
    fetchFinanceReportDiscountTotal(year, month),
    getDepositsAttributedToMonth({ year, month }),
  ]);

  const cost = goods?.cost || 0;
  const productPurchase =
    expenses?.byCategory["Product purchase"] ||
    expenses?.byCategory["Закуплено товару"] ||
    expenses?.byCategory["Закуплений товар"] ||
    0;
  const investments =
    expenses?.byCategory["Інвестиції в салон"] ||
    expenses?.byCategory["Инвестиции в салон"] ||
    expenses?.byCategory["Інвестиції"] ||
    0;
  const deposits = depositsAttributed.total;
  const management = expenses?.byCategory["Управління"] || expenses?.byCategory["Управление"] || 0;

  const services = summary?.totals.services || 0;
  const markup = summary && goods ? summary.totals.goods - goods.cost : 0;
  const totalIncome = services + markup;

  const salaryFromAPI =
    expenses?.byCategory["Зарплата співробітникам"] || expenses?.byCategory["Team salaries"] || 0;
  const rentFromAPI = expenses?.byCategory["Оренда"] || expenses?.byCategory["Rent"] || 0;
  const rent = rentFromAPI > 0 ? rentFromAPI : manualFields.rent || 0;
  const cmmFromAPI = expenses?.byCategory["Маркетинг"] || expenses?.byCategory["Marketing"] || 0;
  const targetFromAPI = expenses?.byCategory["Таргет оплата роботи маркетологів"] || 0;
  const advertisingFromAPI = expenses?.byCategory["Реклама, Бюджет, ФБ"] || 0;
  const directFromAPI = expenses?.byCategory["Дірект"] || expenses?.byCategory["Direct"] || 0;
  const direct = directFromAPI > 0 ? directFromAPI : manualFields.direct || 0;
  const taxesFromAPI = expenses?.byCategory["Податки та збори"] || expenses?.byCategory["Taxes and fees"] || 0;
  const miscExpensesFromAPI = getHospodarskiMiscExpense(expenses);
  const deliveryFromAPI =
    expenses?.byCategory["Доставка товарів (Нова Пошта)"] ||
    expenses?.byCategory["Доставка товарів (Каса Нова Пошта)"] ||
    expenses?.byCategory["Доставка товарів"] ||
    0;
  const consumablesFromAPI =
    expenses?.byCategory["Consumables purchase"] || expenses?.byCategory["Закупівля матеріалів"] || 0;
  const stationeryFromAPI = expenses?.byCategory["Канцелярські, миючі товари та засоби"] || 0;
  const salonCleaningFromAPI = expenses?.byCategory["Прибирання салону"] || 0;
  const productsForGuestsFromAPI = expenses?.byCategory["Продукти для гостей"] || 0;
  const hairSalesCommissionFromAPI = expenses?.byCategory["Комісійні % за продаж волосся"] || 0;
  const acquiringFromAPI =
    expenses?.byCategory["Комісія за еквайринг"] ||
    expenses?.byCategory["Еквайринг"] ||
    expenses?.byCategory["Acquiring"] ||
    0;
  const acquiring = acquiringFromAPI > 0 ? acquiringFromAPI : manualFields.acquiring || 0;
  const terminalFromAPI = getTerminalExpenseFromApi(expenses);
  const utilitiesFromAPI =
    expenses?.byCategory["Інтернет, CRM і т д."] ||
    expenses?.byCategory["Інтеренет, CRM, IP і т. д."] ||
    expenses?.byCategory["Комунальні, Інтеренет, ІР і т. д."] ||
    expenses?.byCategory["Комунальні, Інтеренет, IP і т. д."] ||
    0;
  const repairFromAPI = expenses?.byCategory["Ремонт обладнання, інструментів"] || 0;
  const accountingFromAPI = expenses?.byCategory["Бухгалтерія"] || expenses?.byCategory["Accounting"] || 0;
  const accounting = accountingFromAPI > 0 ? accountingFromAPI : manualFields.accounting || 0;

  const salary = salaryFromAPI;
  const marketingTotal = cmmFromAPI + targetFromAPI + advertisingFromAPI + direct;
  const taxes = taxesFromAPI + (manualFields.taxes_extra || 0);
  const otherExpensesTotal =
    miscExpensesFromAPI +
    deliveryFromAPI +
    consumablesFromAPI +
    stationeryFromAPI +
    salonCleaningFromAPI +
    productsForGuestsFromAPI +
    hairSalesCommissionFromAPI +
    acquiring +
    terminalFromAPI +
    utilitiesFromAPI +
    repairFromAPI;
  const accountingTaxesTotal = accounting + taxes + discountAmount;
  const totalExpenses = salary + rent + marketingTotal + otherExpensesTotal + accountingTaxesTotal;

  const profit = totalIncome - totalExpenses;
  const ownerProfit = profit - management;
  const fopOrekhovskaPayments = sumFopOrekhovskaPayments(expenses);
  const returns =
    expenses?.byCategory["Повернення"] ||
    expenses?.byCategory["Returns"] ||
    expenses?.byCategory["Return"] ||
    0;

  return cost + ownerProfit - productPurchase - investments + fopOrekhovskaPayments - returns - deposits;
}
