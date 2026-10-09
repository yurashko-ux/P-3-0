"use client";

import { useCallback, useEffect, useState } from "react";
import { cashCountUnit } from "@/lib/finance/cash-denominations";

type CashCountRow = {
  id: string;
  kyivDay: string;
  savedAt: string;
  authorName: string;
  accountTitle: string;
  currency: string;
  counted: number;
};

function money(n: number) {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });
}

function kyivStamp(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "—", time: "" };
  const day = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { date: day, time };
}

function unitOf(currency: string): string {
  if (currency === "USD" || currency === "EUR" || currency === "UAH") {
    return cashCountUnit(currency);
  }
  return currency;
}

export default function FinanceKasaPage() {
  const [counts, setCounts] = useState<CashCountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/kasa?limit=300", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка завантаження");
      setCounts(json.counts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeCount(row: CashCountRow) {
    const stamp = kyivStamp(row.savedAt);
    const ok = window.confirm(
      `Видалити касовку ${row.accountTitle} на ${money(row.counted)} ${unitOf(row.currency)} від ${stamp.date} ${stamp.time}?\n\nПлатежі, які вона провела, знову стануть незведеними.`,
    );
    if (!ok) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/kasa?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(typeof json?.error === "string" ? json.error : "Не вдалося видалити касовку");
      }
      setCounts((prev) => prev.filter((item) => item.id !== row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="px-3 pb-6 pt-2 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-gray-600">
          Кожен рядок — натискання «Зберегти» в касовці. Дві касовки одного дня не зливаються.
        </p>
        <button type="button" className="btn btn-sm ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Оновити"}
        </button>
      </div>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <div className="bg-white border rounded-xl overflow-auto max-h-[calc(100vh-11rem)]">
        <table className="table table-xs w-full">
          <thead className="sticky top-0 z-10 bg-[#eef1f6] [&_th]:bg-[#eef1f6]">
            <tr>
              <th>Дата</th>
              <th>Час</th>
              <th>Користувач</th>
              <th>Каса</th>
              <th className="text-right">Сума</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {counts.map((row) => {
              const stamp = kyivStamp(row.savedAt);
              return (
                <tr key={row.id}>
                  <td className="tabular-nums whitespace-nowrap">{stamp.date}</td>
                  <td className="tabular-nums whitespace-nowrap">{stamp.time}</td>
                  <td>{row.authorName || "—"}</td>
                  <td>{row.accountTitle}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">
                    {money(row.counted)} {unitOf(row.currency)}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      disabled={busyId === row.id}
                      title="Видалити касовку"
                      onClick={() => void removeCount(row)}
                    >
                      {busyId === row.id ? "…" : "🗑"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && counts.length === 0 && <p className="p-4 text-sm text-gray-500">Збережених касовок ще немає.</p>}
        {loading && counts.length === 0 && <p className="p-4 text-sm text-gray-500">Завантаження…</p>}
      </div>
    </main>
  );
}
