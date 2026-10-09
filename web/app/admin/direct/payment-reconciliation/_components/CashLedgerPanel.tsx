"use client";

import { useEffect, useMemo, useState } from "react";
import { cashCountUnit, type CashCountCurrency } from "@/lib/finance/cash-denominations";

export type CashKindFilter = "all" | "cash" | "non_cash";

export const CASH_KIND_OPTIONS: Array<{ value: CashKindFilter; label: string }> = [
  { value: "all", label: "Всі" },
  { value: "cash", label: "Готівкові" },
  { value: "non_cash", label: "Безготівкові" },
];

type LedgerCount = {
  id: string;
  kyivDay: string;
  counted: number;
  currency: string;
  createdAt: string;
  authorName: string;
};

type LedgerRow = {
  id: string;
  accountTitle: string;
  currency: CashCountCurrency;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
  occurredAt: string;
  title: string;
  recordId: number | null;
  posted: boolean;
  count: LedgerCount | null;
};

function money(n: number): string {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function dayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  if (!day || !month || !year) return kyivDay;
  return `${day}.${month}.${year}`;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
}

export function CashKindSwitch({
  value,
  onChange,
}: {
  value: CashKindFilter;
  onChange: (value: CashKindFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CASH_KIND_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
            value === option.value
              ? "bg-emerald-700 text-white"
              : "bg-white text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CashLedgerPanel({
  direction,
  status,
}: {
  direction: "in" | "out";
  status: "open" | "linked" | "all";
}) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch("/api/admin/finance/cash/ledger", { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити готівку");
        if (!cancelled) setRows(json.rows || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка готівки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    const visible = rows.filter((row) => {
      if (row.direction !== direction) return false;
      if (status === "linked") return row.posted;
      if (status === "open") return !row.posted;
      return true;
    });
    const byDay = new Map<string, LedgerRow[]>();
    for (const row of visible) {
      const list = byDay.get(row.kyivDay) || [];
      list.push(row);
      byDay.set(row.kyivDay, list);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([kyivDay, dayRows]) => {
        const counts = new Map<string, LedgerCount & { accountTitle: string }>();
        for (const row of dayRows) {
          if (!row.count) continue;
          if (!counts.has(row.count.id)) {
            counts.set(row.count.id, { ...row.count, accountTitle: row.accountTitle });
          }
        }
        return { kyivDay, rows: dayRows, counts: [...counts.values()] };
      });
  }, [rows, direction, status]);

  if (loading) {
    return <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження готівки…</p>;
  }
  if (error) {
    return <div className="m-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>;
  }
  if (days.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-gray-500">
        {status === "linked" ? "Зведених готівкових платежів немає." : "Готівкових платежів немає."}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      {days.map((day) => (
        <section key={day.kyivDay} className="border-t-2 border-gray-800 first:border-t-0">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(180px,240px)] bg-slate-300 text-[10px]">
            <div className="px-2 py-1 font-bold uppercase tracking-wide text-gray-900">{dayLabel(day.kyivDay)}</div>
            <div className="border-l border-gray-300 px-2 py-1 text-right font-semibold text-emerald-900">Касовка</div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(180px,240px)]">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-gray-50 text-[9px] uppercase text-gray-500">
                <tr>
                  <th className="px-2 py-1 font-medium">Хто</th>
                  <th className="px-2 py-1 font-medium">Час</th>
                  <th className="px-2 py-1 font-medium">Запис</th>
                  <th className="px-2 py-1 font-medium">Рахунок</th>
                  <th className="px-2 py-1 font-medium">Тип</th>
                  <th className="px-2 py-1 text-right font-medium">Сума</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map((row) => {
                  const unit = cashCountUnit(row.currency);
                  const incoming = row.direction === "in";
                  return (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-800">{row.title}</td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">{timeLabel(row.occurredAt)}</td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">
                        {row.recordId ? row.recordId : "—"}
                      </td>
                      <td className="px-2 py-1 text-gray-700">{row.accountTitle}</td>
                      <td className={`px-2 py-1 font-semibold ${incoming ? "text-green-700" : "text-red-600"}`}>
                        {incoming ? "↓" : "↑"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums text-gray-900">
                        {money(row.amount)} {unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-l border-gray-200 bg-emerald-50/40 px-2 py-2 text-[11px]">
              {day.counts.length === 0 ? (
                <span className="text-gray-400">—</span>
              ) : (
                day.counts.map((count) => (
                  <div key={count.id} className="mb-2 last:mb-0">
                    <div className="font-semibold text-gray-900">{dayLabel(count.kyivDay)}</div>
                    <div className="tabular-nums text-emerald-900">
                      {money(count.counted)} {cashCountUnit((count.currency as CashCountCurrency) || "UAH")}
                    </div>
                    <div className="text-gray-600">{count.authorName || "—"}</div>
                    {day.counts.length > 1 ? <div className="text-[10px] text-gray-500">{count.accountTitle}</div> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
