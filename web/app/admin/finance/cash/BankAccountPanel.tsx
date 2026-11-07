"use client";

import { useEffect, useMemo, useState } from "react";

type StatementRow = {
  id: string;
  time: string;
  amount: number;
  balance: number | null;
  counterName: string;
  title: string;
};

function money(n: number): string {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function kyivDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  return `${day}.${month}.${year}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Рухи безготівкового рахунку з банку: той самий вигляд, що й готівка в Касі. */
export function BankAccountPanel({
  accountId,
  accountTitle,
  reloadToken,
  onClose,
}: {
  accountId: number;
  accountTitle: string;
  reloadToken: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/finance/cash/account-statement?accountId=${accountId}`, {
          cache: "no-store",
          credentials: "include",
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити рухи рахунку");
        if (!cancelled) setRows(json.rows || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка завантаження рухів");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadToken]);

  const days = useMemo(() => {
    const byDay = new Map<string, StatementRow[]>();
    for (const row of rows) {
      const kyivDay = kyivDayOf(row.time);
      byDay.set(kyivDay, [...(byDay.get(kyivDay) || []), row]);
    }
    return [...byDay.entries()].map(([kyivDay, dayRows]) => ({
      kyivDay,
      rows: dayRows,
      net: dayRows.reduce((sum, row) => sum + row.amount, 0),
      // Рядки новіші зверху: перший із балансом — залишок на кінець дня
      balance: dayRows.find((row) => row.balance != null)?.balance ?? null,
    }));
  }, [rows]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-gray-900">Рухи рахунку: {accountTitle}</span>
        <button type="button" className="btn btn-outline btn-xs h-6 min-h-0 px-2 text-[10px]" onClick={onClose}>
          До готівки
        </button>
      </div>
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : loading && rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження рухів…</p>
      ) : days.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-500">Рухів немає.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {days.map((day) => (
            <section key={day.kyivDay} className="border-t border-gray-200 first:border-t-0">
              <table className="w-full table-fixed text-left text-[10px]">
                <colgroup>
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "42%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-300 text-[10px] text-gray-900">
                    <th colSpan={4} className="px-2 py-1 text-left font-bold uppercase tracking-wide">
                      {dayLabel(day.kyivDay)}
                      {day.balance != null ? (
                        <span className="ml-3 font-medium normal-case tracking-normal tabular-nums">
                          залишок: {money(day.balance)} грн
                        </span>
                      ) : null}
                    </th>
                    <th
                      colSpan={2}
                      className="whitespace-nowrap px-2 py-1 text-right font-bold normal-case tracking-normal tabular-nums"
                    >
                      {money(day.net)} грн
                    </th>
                  </tr>
                  <tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                    <th className="px-2 py-1 font-medium">№</th>
                    <th className="px-2 py-1 font-medium">Контрагент</th>
                    <th className="px-2 py-1 font-medium">Призначення</th>
                    <th className="px-2 py-1 font-medium">Час</th>
                    <th className="px-2 py-1 font-medium">Тип</th>
                    <th className="px-2 py-1 text-right font-medium">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {day.rows.map((row, index) => {
                    const incoming = row.amount >= 0;
                    return (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-2 py-1 tabular-nums text-gray-500">{index + 1}</td>
                        <td className="truncate px-2 py-1 text-gray-800" title={row.counterName || undefined}>
                          {row.counterName || "—"}
                        </td>
                        <td className="truncate px-2 py-1 text-gray-700" title={row.title || undefined}>
                          {row.title || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">{timeLabel(row.time)}</td>
                        <td className={`px-2 py-1 font-semibold ${incoming ? "text-green-700" : "text-red-600"}`}>
                          {incoming ? "↓" : "↑"}
                        </td>
                        <td
                          className={`whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums ${
                            incoming ? "text-gray-900" : "text-red-600"
                          }`}
                        >
                          {money(row.amount)} грн
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
