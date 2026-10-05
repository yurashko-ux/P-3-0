"use client";

import { useCallback, useEffect, useState } from "react";

type Part = { schemeId: string; title: string; amountUah: number; breakdown: string };

type Cell = {
  amountUah: number;
  servicesUah: number;
  goodsUah: number;
  hairSalesUah: number;
  worked: boolean;
  parts: Part[];
};

type Payroll = {
  month: string;
  days: string[];
  people: Array<{ id: string; name: string }>;
  cells: Record<string, Record<string, Cell>>;
  running: Record<string, number>;
  totals: Record<string, number>;
  monthTotalUah: number;
};

function currentKyivMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value || "2026";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  return `${year}-${month}`;
}

function formatUah(n: number): string {
  return new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
}

function formatDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

export default function TeamPayrollPage() {
  const [month, setMonth] = useState(currentKyivMonth);
  const [data, setData] = useState<Payroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<{ day: string; personId: string } | null>(null);

  const load = useCallback(async (value: string) => {
    setLoading(true);
    setError(null);
    setPicked(null);
    try {
      const res = await fetch(`/api/admin/team/payroll?month=${encodeURIComponent(value)}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка нарахування");
      setData(json);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const pickedPerson = data?.people.find((p) => p.id === picked?.personId) || null;
  const pickedCell = picked && data ? data.cells[picked.day]?.[picked.personId] : null;

  return (
    <main className="p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="form-control">
          <span className="label py-0 min-h-0">
            <span className="label-text text-xs text-gray-500">Місяць</span>
          </span>
          <input
            type="month"
            className="input input-bordered input-sm h-8"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
        {data && (
          <p className="text-sm text-gray-600 pb-1">
            Разом за місяць: <span className="font-semibold text-gray-900">{formatUah(data.monthTotalUah)} ₴</span>
          </p>
        )}
      </div>
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Сума дня з закритих чеків Kresco. Кожен, хто на рядку, бере повну суму, далі свій відсоток. Оклад за місяць
        стоїть 1-го числа. Наростаючий підсумок обнуляється з новим місяцем.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      {loading && <p className="text-sm text-gray-400">Рахуємо…</p>}

      {data && data.people.length === 0 && !loading && (
        <p className="text-sm text-gray-500">Немає людей у команді.</p>
      )}

      {data && data.people.length > 0 && (
        <div className="overflow-x-auto bg-white border rounded-xl">
          <table className="table table-xs table-fixed w-full">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white z-10">Дата</th>
                {data.people.map((person) => (
                  <th key={person.id} className="min-w-[7rem] text-right">
                    {person.name}
                  </th>
                ))}
                <th className="min-w-[8rem] text-right">Наростаючий</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr key={day}>
                  <td className="sticky left-0 bg-white z-10 tabular-nums whitespace-nowrap">{formatDay(day)}</td>
                  {data.people.map((person) => {
                    const cell = data.cells[day]?.[person.id];
                    const amount = cell?.amountUah || 0;
                    const active = picked?.day === day && picked.personId === person.id;
                    return (
                      <td key={person.id} className="text-right p-0">
                        <button
                          type="button"
                          className={`w-full px-2 py-1 tabular-nums text-right hover:bg-gray-50 ${active ? "bg-amber-50" : ""}`}
                          onClick={() => setPicked({ day, personId: person.id })}
                        >
                          {amount ? formatUah(amount) : <span className="text-gray-300">—</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums font-medium">{formatUah(data.running[day] || 0)}</td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="sticky left-0 bg-white z-10 font-semibold">Разом</td>
                {data.people.map((person) => (
                  <td key={person.id} className="text-right tabular-nums font-semibold">
                    {formatUah(data.totals[person.id] || 0)}
                  </td>
                ))}
                <td className="text-right tabular-nums font-semibold">{formatUah(data.monthTotalUah)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {picked && pickedPerson && pickedCell && (
        <div className="bg-white border rounded-xl p-3 space-y-2 max-w-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-sm">
                {pickedPerson.name} · {formatDay(picked.day)}
              </div>
              <div className="text-sm tabular-nums">{formatUah(pickedCell.amountUah)} ₴</div>
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPicked(null)}>
              Закрити
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Послуги {formatUah(pickedCell.servicesUah)} ₴ · товари {formatUah(pickedCell.goodsUah)} ₴ · волосся{" "}
            {formatUah(pickedCell.hairSalesUah)} ₴
            {pickedCell.worked ? " · є чек" : ""}
          </p>
          {pickedCell.parts.length === 0 ? (
            <p className="text-xs text-gray-400">Немає нарахування за цей день.</p>
          ) : (
            <ul className="space-y-1">
              {pickedCell.parts.map((part, index) => (
                <li key={`${part.schemeId}-${index}`} className="text-xs border border-gray-200 rounded-md px-2 py-1">
                  <div className="flex justify-between gap-2">
                    <span>{part.title}</span>
                    <span className="tabular-nums">{formatUah(part.amountUah)} ₴</span>
                  </div>
                  <div className="text-gray-500">{part.breakdown}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
