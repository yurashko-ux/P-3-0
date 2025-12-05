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

async function getSummaryForMonth(
  year: number,
  month: number,
): Promise<{
  summary: FinanceSummary | null;
  goods: GoodsSalesSummary | null;
  expenses: ExpensesSummary | null;
  manualExpenses: number | null;
  error: string | null;
}> {
  const { from, to } = monthRange(year, month);

  // Отримуємо ручні витрати з KV
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
    return { summary, goods, expenses, manualExpenses, error: null };
  } catch (e: any) {
    return {
      summary: null,
      goods: null,
      expenses: null,
      manualExpenses: null,
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

  const { summary, goods, expenses, manualExpenses, error } = await getSummaryForMonth(
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
                    <EditCostButton
                      year={selectedYear}
                      month={selectedMonth}
                      currentCost={goods.cost}
                    />
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
            </div>
          </section>

          {/* Розходи за місяць */}
          <section className="card bg-base-100 shadow-sm">
            <div className="card-body p-4 space-y-3">
              <h2 className="card-title text-base md:text-lg">
                Розходи за місяць
              </h2>
              
              {/* Окрема група: Інкасація (не враховується в сумі розходів) */}
              {expenses && expenses.transactions.length > 0 && (() => {
                const encashment = expenses.byCategory["Інкасація"] || expenses.byCategory["Инкасація"] || 0;
                const management = expenses.byCategory["Управління"] || expenses.byCategory["Управление"] || 0;
                const productPurchase = expenses.byCategory["Product purchase"] || 0;
                const investments = expenses.byCategory["Інвестиції в салон"] || expenses.byCategory["Инвестиции в салон"] || 0;
                const encashmentTotal = encashment + management + productPurchase + investments;
                
                if (encashmentTotal > 0) {
                  return (
                    <div className="mb-4 p-4 bg-blue-50 rounded border border-blue-200">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">
                        Інкасація
                      </h3>
                      <div className="space-y-2">
                        {encashment > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">
                              Інкасація
                            </span>
                            <span className="text-sm font-semibold">
                              {formatMoney(encashment)} грн.
                            </span>
                          </div>
                        )}
                        {management > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">
                              Управління
                            </span>
                            <span className="text-sm font-semibold">
                              {formatMoney(management)} грн.
                            </span>
                          </div>
                        )}
                        {productPurchase > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">
                              Product purchase
                            </span>
                            <span className="text-sm font-semibold">
                              {formatMoney(productPurchase)} грн.
                            </span>
                          </div>
                        )}
                        {investments > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">
                              Інвестиції в салон
                            </span>
                            <span className="text-sm font-semibold">
                              {formatMoney(investments)} грн.
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center pt-2 border-t border-blue-300">
                          <span className="text-sm font-medium text-gray-700">
                            Всього інкасації
                          </span>
                          <span className="text-sm font-semibold">
                            {formatMoney(encashmentTotal)} грн.
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs uppercase text-gray-500">
                    Всього розходів
                  </p>
                  <EditExpensesButton
                    year={selectedYear}
                    month={selectedMonth}
                    currentExpenses={manualExpenses || 0}
                  />
                </div>
                <p className="text-xl font-semibold">
                  {(() => {
                    // Віднімаємо інкасацію, управління, product purchase та інвестиції від загальної суми
                    const encashment = expenses?.byCategory["Інкасація"] || expenses?.byCategory["Инкасація"] || 0;
                    const management = expenses?.byCategory["Управління"] || expenses?.byCategory["Управление"] || 0;
                    const productPurchase = expenses?.byCategory["Product purchase"] || 0;
                    const investments = expenses?.byCategory["Інвестиції в салон"] || expenses?.byCategory["Инвестиции в салон"] || 0;
                    const encashmentTotal = encashment + management + productPurchase + investments;
                    const expensesTotal = expenses?.total || 0;
                    const totalWithoutEncashment = expensesTotal - encashmentTotal;
                    return formatMoney(Math.max(0, totalWithoutEncashment) + (manualExpenses || 0));
                  })()} грн.
                </p>
                {expenses && expenses.total > 0 && manualExpenses && manualExpenses > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    (з API: {(() => {
                      const encashment = expenses.byCategory["Інкасація"] || expenses.byCategory["Инкасація"] || 0;
                      const management = expenses.byCategory["Управління"] || expenses.byCategory["Управление"] || 0;
                      const productPurchase = expenses.byCategory["Product purchase"] || 0;
                      const investments = expenses.byCategory["Інвестиції в салон"] || expenses.byCategory["Инвестиции в салон"] || 0;
                      const encashmentTotal = encashment + management + productPurchase + investments;
                      return formatMoney(Math.max(0, expenses.total - encashmentTotal - manualExpenses));
                    })()} грн. + ручні: {formatMoney(manualExpenses)} грн.)
                  </p>
                )}
                {!expenses || expenses.total === 0 ? (
                  <p className="text-xs text-gray-500 mt-1">
                    Використовуйте кнопку ✏️ для введення витрат вручну
                  </p>
                ) : null}
              </div>

              {expenses && expenses.transactions.length > 0 ? (
                <>

                  {/* Витрати по категоріях (виключаємо небажані категорії) */}
                  {Object.keys(expenses.byCategory).length > 0 && (() => {
                    // Фільтруємо категорії та обчислюємо загальну суму
                    const filteredCategories = Object.entries(expenses.byCategory)
                      .filter(([category]) => {
                        // Виключаємо небажані категорії
                        const lower = category.toLowerCase();
                        return !lower.includes("service payments") &&
                               !lower.includes("product sales") &&
                               !category.includes("Зняття з ФОП") &&
                               !category.includes("Фоп саша") &&
                               !category.includes("ФОП саша") &&
                               category !== "Інкасація" &&
                               category !== "Инкасація" &&
                               category !== "Управління" &&
                               category !== "Управление" &&
                               category !== "Product purchase" &&
                               category !== "Інвестиції в салон" &&
                               category !== "Инвестиции в салон";
                      });
                    
                    // Обчислюємо загальну суму всіх категорій
                    const categoriesTotal = filteredCategories.reduce((sum, [, amount]) => sum + amount, 0);
                    
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-gray-700">
                            Розбивка по категоріях:
                          </p>
                          <div className="px-3 py-1 bg-red-50 border-2 border-red-300 rounded">
                            <span className="text-sm font-bold text-red-700">
                              {formatMoney(categoriesTotal)} грн.
                            </span>
                          </div>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                          {filteredCategories
                            .sort(([, a], [, b]) => b - a)
                            .map(([category, amount], index) => (
                              <div
                                key={category}
                                className="flex justify-between items-center p-2 bg-gray-50 rounded"
                              >
                                <span className="text-sm text-gray-600">
                                  {index + 1}. {category}
                                </span>
                                <span className="text-sm font-semibold">
                                  {formatMoney(amount)} грн.
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="text-sm text-gray-500">
                  <p>
                    Витрати з Altegio API не знайдені або не налаштовані.
                  </p>
                  <p className="mt-2">
                    Використовуйте P&L звіт для введення витрат вручну.
                  </p>
                </div>
              )}

              {/* Примітка про ручне введення */}
              <div className="mt-4 p-3 bg-blue-50 rounded text-xs text-gray-600">
                <p className="font-medium mb-1">Примітка:</p>
                <p>
                  Деякі категорії витрат (ЗП, Оренда, Бухгалтерія, Реклама,
                  Податки тощо) можуть бути недоступні через API і потребують
                  ручного введення з P&L звіту.
                </p>
              </div>
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


