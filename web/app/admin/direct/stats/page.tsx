// web/app/admin/direct/stats/page.tsx
// Сторінка статистики Direct

"use client";

import { useState, useEffect, useMemo } from "react";

type MastersStatsRow = {
  masterId: string;
  masterName: string;
  role: string;
  clients: number;
  consultBooked: number;
  consultAttended: number;
  paidAttended: number;
  rebooksCreated: number;
  futureSum?: number;
  monthToEndSum?: number;
  nextMonthSum?: number;
  plus2MonthSum?: number;
  servicesSum?: number;
  hairSum?: number;
  goodsSum?: number;
};

export default function DirectStatsPage() {
  // Місячний фільтр KPI (calendar month, Europe/Kyiv): YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    try {
      const kyivDay = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const m = kyivDay.slice(0, 7);
      // Мінімальний доступний місяць: 2026-01
      return m < '2026-01' ? '2026-01' : m;
    } catch {
      const m = new Date().toISOString().slice(0, 7);
      return m < '2026-01' ? '2026-01' : m;
    }
  });

  const [mastersStats, setMastersStats] = useState<{
    loading: boolean;
    error: string | null;
    rows: MastersStatsRow[];
    totalClients: number;
  }>({ loading: false, error: null, rows: [], totalClients: 0 });

  const monthOptions = useMemo(() => {
    // Доступні місяці: від 2026-01 і далі (без 2024/2025).
    // Щоб можна було вибирати наперед (лютий, березень і т.д.), будуємо вперед на 24 місяці.
    const out: Array<{ value: string; label: string }> = [];
    const startYear = 2026;
    const startMonthIdx = 0; // Jan
    const start = new Date(startYear, startMonthIdx, 1);
    for (let i = 0; i < 24; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const value = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
      out.push({ value, label });
    }
    return out;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        setMastersStats((s) => ({ ...s, loading: true, error: null }));
        const params = new URLSearchParams();
        params.set('month', selectedMonth);

        const res = await fetch(`/api/admin/direct/masters-stats?${params.toString()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || 'Не вдалося завантажити статистику');
        if (cancelled) return;

        const mastersRows: MastersStatsRow[] = Array.isArray(data.masters) ? data.masters : [];
        const unassignedRow: MastersStatsRow | null = data.unassigned && typeof data.unassigned === 'object' ? data.unassigned : null;
        const rows = unassignedRow ? [...mastersRows, unassignedRow] : mastersRows;

        setMastersStats({
          loading: false,
          error: null,
          rows,
          totalClients: typeof data.totalClients === 'number' ? data.totalClients : 0,
        });
      } catch (err) {
        if (cancelled) return;
        setMastersStats((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  const formatUAHExact = (amountUAH: number): string => {
    const n = Math.round(amountUAH);
    return `${n.toLocaleString('uk-UA')} грн`;
  };

  // Формат як у колонці "Продажі": округляємо до тисяч і показуємо "тис."
  const formatUAHThousands = (amountUAH: number): string => {
    const n = Math.round(amountUAH);
    return `${Math.round(n / 1000).toLocaleString('uk-UA')} тис.`;
  };

  // KPI-таблиця: робимо максимально компактно — ховаємо рядки, де всі значення = 0
  const compactStatsRows = useMemo(() => {
    const rows = mastersStats.rows || [];
    const nonZero = (r: MastersStatsRow) =>
      (r.clients || 0) > 0 ||
      (r.consultBooked || 0) > 0 ||
      (r.consultAttended || 0) > 0 ||
      (r.paidAttended || 0) > 0 ||
      (r.rebooksCreated || 0) > 0 ||
      (r.futureSum || 0) > 0 ||
      (r.monthToEndSum || 0) > 0 ||
      (r.nextMonthSum || 0) > 0 ||
      (r.plus2MonthSum || 0) > 0 ||
      (r.servicesSum || 0) > 0 ||
      (r.hairSum || 0) > 0 ||
      (r.goodsSum || 0) > 0;
    const filtered = rows.filter((r) => nonZero(r) || r.masterId === 'unassigned');
    // Якщо все нуль — показуємо як є (щоб не було порожньо)
    return filtered.length ? filtered : rows;
  }, [mastersStats.rows]);

  const statsTotals = useMemo(() => {
    const rows = mastersStats.rows || [];
    // Підсумки по всіх рядках (включно "Без майстра"), щоб цифри сходились з загальним.
    return rows.reduce(
      (acc, r) => {
        acc.clients += r.clients || 0;
        acc.consultBooked += r.consultBooked || 0;
        acc.consultAttended += r.consultAttended || 0;
        acc.paidAttended += r.paidAttended || 0;
        acc.rebooksCreated += r.rebooksCreated || 0;
        acc.futureSum += r.futureSum || 0;
        acc.monthToEndSum += r.monthToEndSum || 0;
        acc.nextMonthSum += r.nextMonthSum || 0;
        acc.plus2MonthSum += r.plus2MonthSum || 0;
        acc.servicesSum += r.servicesSum || 0;
        acc.hairSum += r.hairSum || 0;
        acc.goodsSum += r.goodsSum || 0;
        return acc;
      },
      {
        clients: 0,
        consultBooked: 0,
        consultAttended: 0,
        paidAttended: 0,
        rebooksCreated: 0,
        futureSum: 0,
        monthToEndSum: 0,
        nextMonthSum: 0,
        plus2MonthSum: 0,
        servicesSum: 0,
        hairSum: 0,
        goodsSum: 0,
      }
    );
  }, [mastersStats.rows]);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Статистика <span className="text-base">▲</span>
          </h1>
          <div className="text-sm text-gray-600">
            {selectedMonth} • клієнтів: {mastersStats.totalClients}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Місяць</span>
            <select
              className="select select-bordered select-xs"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          {mastersStats.loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : mastersStats.error ? (
            <div className="alert alert-error">
              <span>Помилка статистики: {mastersStats.error}</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="inline-block w-max min-w-full">
                <table
                  className="table table-compact table-xs w-auto leading-tight border-collapse"
                  style={{ tableLayout: "auto" }}
                >
                  <thead>
                    <tr>
                      <th className="text-[12px] py-0.5 px-1 whitespace-nowrap w-[120px] max-w-[120px] text-base-content">
                        Майстер
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.clients}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>Кл</span>
                          <span className="text-[11px] opacity-60">{statsTotals.clients}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[58px] text-base-content" title={`${statsTotals.consultBooked}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>Конс</span>
                          <span className="text-[11px] opacity-60">{statsTotals.consultBooked}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.consultAttended}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>✅К</span>
                          <span className="text-[11px] opacity-60">{statsTotals.consultAttended}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.paidAttended}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>✅З</span>
                          <span className="text-[11px] opacity-60">{statsTotals.paidAttended}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[66px] text-base-content" title={`${statsTotals.rebooksCreated}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>🔁</span>
                          <span className="text-[11px] opacity-60">{statsTotals.rebooksCreated}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.futureSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Майб</span>
                          <span className="text-[11px] opacity-60">{statsTotals.futureSum > 0 ? formatUAHThousands(statsTotals.futureSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.monthToEndSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>До кін</span>
                          <span className="text-[11px] opacity-60">{statsTotals.monthToEndSum > 0 ? formatUAHThousands(statsTotals.monthToEndSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.nextMonthSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Наст</span>
                          <span className="text-[11px] opacity-60">{statsTotals.nextMonthSum > 0 ? formatUAHThousands(statsTotals.nextMonthSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.plus2MonthSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>+2</span>
                          <span className="text-[11px] opacity-60">{statsTotals.plus2MonthSum > 0 ? formatUAHThousands(statsTotals.plus2MonthSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.servicesSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Послуги</span>
                          <span className="text-[11px] opacity-60">{statsTotals.servicesSum > 0 ? formatUAHThousands(statsTotals.servicesSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.hairSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Волосся</span>
                          <span className="text-[11px] opacity-60">{statsTotals.hairSum > 0 ? formatUAHThousands(statsTotals.hairSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.goodsSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Товар</span>
                          <span className="text-[11px] opacity-60">{statsTotals.goodsSum > 0 ? formatUAHThousands(statsTotals.goodsSum) : '0 тис.'}</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {compactStatsRows.map((r) => (
                      <tr key={r.masterId}>
                        <td className="text-[12px] whitespace-nowrap py-0.5 px-1 w-[120px] max-w-[120px] text-base-content">
                          <span className="font-medium block truncate" title={r.masterName}>
                            {r.masterName}
                          </span>
                        </td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.clients}</td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[58px] text-base-content tabular-nums">{r.consultBooked}</td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.consultAttended}</td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.paidAttended}</td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[66px] text-base-content tabular-nums"
                          title={
                            r.paidAttended > 0
                              ? `${r.rebooksCreated} / ${r.paidAttended} = ${Math.round((r.rebooksCreated / r.paidAttended) * 1000) / 10}%`
                              : ''
                          }
                        >
                          {r.rebooksCreated}
                          {r.paidAttended > 0 ? (
                            <span className="ml-1 text-[12px] opacity-60">({Math.round((r.rebooksCreated / r.paidAttended) * 1000) / 10}%)</span>
                          ) : null}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.futureSum === 'number' ? formatUAHExact(r.futureSum) : ''}
                        >
                          {typeof r.futureSum === 'number' && r.futureSum > 0 ? formatUAHThousands(r.futureSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.monthToEndSum === 'number' ? formatUAHExact(r.monthToEndSum) : ''}
                        >
                          {typeof r.monthToEndSum === 'number' && r.monthToEndSum > 0 ? formatUAHThousands(r.monthToEndSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.nextMonthSum === 'number' ? formatUAHExact(r.nextMonthSum) : ''}
                        >
                          {typeof r.nextMonthSum === 'number' && r.nextMonthSum > 0 ? formatUAHThousands(r.nextMonthSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.plus2MonthSum === 'number' ? formatUAHExact(r.plus2MonthSum) : ''}
                        >
                          {typeof r.plus2MonthSum === 'number' && r.plus2MonthSum > 0 ? formatUAHThousands(r.plus2MonthSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.servicesSum === 'number' ? formatUAHExact(r.servicesSum) : ''}
                        >
                          {typeof r.servicesSum === 'number' && r.servicesSum > 0 ? formatUAHThousands(r.servicesSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.hairSum === 'number' ? formatUAHExact(r.hairSum) : ''}
                        >
                          {typeof r.hairSum === 'number' && r.hairSum > 0 ? formatUAHThousands(r.hairSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.goodsSum === 'number' ? formatUAHExact(r.goodsSum) : ''}
                        >
                          {typeof r.goodsSum === 'number' && r.goodsSum > 0 ? formatUAHThousands(r.goodsSum) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
