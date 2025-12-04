// web/app/admin/finance-report/page.tsx
import { fetchFinanceSummary } from "@/lib/altegio";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getDefaultSummary() {
  const today = new Date();
  const to = formatDate(today);
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 6); // останні 7 днів
  const from = formatDate(fromDate);

  try {
    const summary = await fetchFinanceSummary({ date_from: from, date_to: to });
    return { summary, error: null as string | null };
  } catch (e: any) {
    return { summary: null, error: String(e?.message || e) };
  }
}

export default async function FinanceReportPage() {
  const { summary, error } = await getDefaultSummary();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Фінансовий звіт (Altegio)</h1>
        {summary && (
          <p className="text-sm text-gray-500">
            Період: {summary.range.date_from} — {summary.range.date_to}
          </p>
        )}
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
                  {summary.totals.total.toFixed(2)} {summary.currency}
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Послуги</p>
                <p className="text-xl font-semibold">
                  {summary.totals.services.toFixed(2)} {summary.currency}
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Товари</p>
                <p className="text-xl font-semibold">
                  {summary.totals.goods.toFixed(2)} {summary.currency}
                </p>
              </div>
            </div>
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body p-4">
                <p className="text-xs uppercase text-gray-500">Середній чек</p>
                <p className="text-xl font-semibold">
                  {summary.totals.avgCheck != null
                    ? `${summary.totals.avgCheck.toFixed(2)} ${summary.currency}`
                    : "—"}
                </p>
              </div>
            </div>
          </section>

          <section className="card bg-base-100 shadow-sm">
            <div className="card-body">
              <h2 className="card-title mb-2">Динаміка виручки по днях</h2>
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
                        <th className="text-right">Виручка, {summary.currency}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.incomeDaily.map((row) => (
                        <tr key={row.date}>
                          <td>{new Date(row.date).toLocaleDateString()}</td>
                          <td className="text-right">{row.value.toFixed(2)}</td>
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

