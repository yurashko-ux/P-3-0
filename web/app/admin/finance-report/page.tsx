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
  ];
  
  for (const fieldKey of fieldKeys) {
    manualFields[fieldKey] = await getManualExpenseField(year, month, fieldKey);
  }

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
    return { summary, goods, expenses, manualExpenses, manualFields, error: null };
  } catch (e: any) {
    return {
      summary: null,
      goods: null,
      expenses: null,
      manualExpenses: null,
      manualFields: {},
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

  const { summary, goods, expenses, manualExpenses, manualFields, error } = await getSummaryForMonth(
    selectedYear,
    selectedMonth,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Фінансовий звіт (Altegio)</h1>
          {summary && (
            <p className="text-sm text-gray-500">
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
          <section className="grid gap-4 md:grid-cols-4">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Всього виручка</p>
                <p className="text-xl font-semibold">
                  {formatMoney(summary.totals.total)} грн.
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Послуги</p>
                <p className="text-xl font-semibold">
                  {formatMoney(summary.totals.services)} грн.
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Товари</p>
                <p className="text-xl font-semibold">
                  {formatMoney(summary.totals.goods)} грн.
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Середній чек</p>
                <p className="text-xl font-semibold">
                  {summary.totals.avgCheck != null
                    ? `${formatMoney(summary.totals.avgCheck)} грн.`
                    : "—"}
                </p>
              </div>
            </div>
          </section>

          {/* Товари: виручка / собівартість / націнка за місяць */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 space-y-3">
              <h2 className="card-title text-base md:text-lg">
                Товари за місяць
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Виручка по товарах
                  </p>
                  <p className="text-lg font-semibold md:text-xl">
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
                        <p className="text-xs text-gray-400 mt-1">
                          Всього продано: {goods.totalItemsSold.toLocaleString("uk-UA")} шт. ({goods.itemsCount} транзакцій)
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-lg font-semibold md:text-xl">— грн.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Націнка (дохід по товарах)
                  </p>
                  <p className="text-lg font-semibold md:text-xl">
                    {summary && goods
                      ? `${formatMoney(summary.totals.goods - goods.cost)} грн.`
                      : "— грн."}
                  </p>
                </div>
              </div>
              
              {/* Список проданих товарів з собівартістю */}
              {goods?.goodsList && goods.goodsList.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    Список проданих товарів
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 pb-2 border-b border-gray-100">
                      <div className="col-span-6">Товар</div>
                      <div className="col-span-2 text-right">Кількість</div>
                      <div className="col-span-2 text-right">Собівартість/од.</div>
                      <div className="col-span-2 text-right">Всього собівартість</div>
                    </div>
                    {goods.goodsList.map((good, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 text-sm py-1 hover:bg-gray-50 rounded">
                        <div className="col-span-6 truncate" title={good.title}>
                          {good.title}
                        </div>
                        <div className="col-span-2 text-right">
                          {good.quantity.toLocaleString("uk-UA")} шт.
                        </div>
                        <div className="col-span-2 text-right">
                          {good.costPerUnit > 0 ? `${formatMoney(good.costPerUnit)} грн.` : "—"}
                        </div>
                        <div className="col-span-2 text-right font-medium">
                          {good.totalCost > 0 ? `${formatMoney(good.totalCost)} грн.` : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Розходи за місяць */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 space-y-4">
              <h2 className="card-title text-base md:text-lg">
                Розходи за місяць
              </h2>
              

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
                  <div className="space-y-4">
                    {/* Розхід без ЗП (постійні) */}
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                      <span className="text-sm font-medium text-gray-700">
                        Розхід без ЗП (постійні)
                      </span>
                      <span className="text-sm font-semibold">
                        {formatMoney(expensesWithoutSalary)} грн.
                      </span>
                    </div>

                    {/* Загальний розхід (червоний фон) */}
                    <div className="flex justify-between items-center p-4 bg-red-100 border-2 border-red-300 rounded">
                      <span className="text-lg font-bold text-red-800">
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
                      <div className="space-y-2 ml-4">
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
                      <div className="space-y-2 ml-4">
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

          <section className="card bg-base-100 shadow-sm">
            <div className="card-body">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <h2 className="card-title">Динаміка виручки по днях</h2>
                <p className="text-sm text-gray-600">
                  Разом за місяць:{" "}
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
              </div>
              {summary.incomeDaily.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Немає даних про виручку по днях за вибраний період.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th className="text-right">Виручка, грн.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.incomeDaily.map((row) => (
                        <tr key={row.date}>
                          <td>{formatDateHuman(row.date)}</td>
                          <td className="text-right">
                            {formatMoney(row.value)} грн.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}


