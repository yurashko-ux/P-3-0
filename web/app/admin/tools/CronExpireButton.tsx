"use client";

import { useState } from "react";

type CronResult = {
  ok: boolean;
  timestamp?: string;
  campaignsProcessed?: number;
  campaignsSkipped?: number;
  totalMoves?: number;
  totalCardsScanned?: number;
  errors: string[];
};

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("uk-UA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

export default function CronExpireButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CronResult | null>(null);

  async function runCron() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/cron/expire?trigger=manual", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const message = data?.error || `HTTP ${res.status}`;
        throw new Error(message);
      }
      const errors = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
      setResult({
        ok: data.ok !== false,
        timestamp: typeof data.timestamp === "string" ? data.timestamp : undefined,
        campaignsProcessed: Number.isFinite(Number(data.campaignsProcessed))
          ? Number(data.campaignsProcessed)
          : undefined,
        campaignsSkipped: Number.isFinite(Number(data.campaignsSkipped))
          ? Number(data.campaignsSkipped)
          : undefined,
        totalMoves: Number.isFinite(Number(data.totalMoves)) ? Number(data.totalMoves) : undefined,
        totalCardsScanned: Number.isFinite(Number(data.totalCardsScanned))
          ? Number(data.totalCardsScanned)
          : undefined,
        errors,
      });
    } catch (err: any) {
      setError(err?.message || "Не вдалося запустити крон");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">EXP Cron</h2>
        <p className="text-sm text-slate-600">
          Добовий крон, що переносить картки з базової воронки у EXP-ціль. Кнопка запускає той самий
          маршрут вручну (працює лише з адмін-кукою).
        </p>
      </div>
      <button
        type="button"
        onClick={runCron}
        disabled={loading}
        className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? "Запуск…" : "Запустити зараз"}
      </button>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 space-y-1">
          <div>
            <span className="font-semibold">Статус:</span>{" "}
            {result.ok ? "успіх" : "є попередження"}
          </div>
          <div>
            <span className="font-semibold">Час виконання:</span>{" "}
            {formatDate(result.timestamp)}
          </div>
          <div>
            <span className="font-semibold">Кампаній опрацьовано:</span>{" "}
            {result.campaignsProcessed ?? 0}
          </div>
          <div>
            <span className="font-semibold">Переміщено карток:</span>{" "}
            {result.totalMoves ?? 0}
          </div>
          <div>
            <span className="font-semibold">Пропущено кампаній:</span>{" "}
            {result.campaignsSkipped ?? 0}
          </div>
          <div>
            <span className="font-semibold">Карток перевірено:</span>{" "}
            {result.totalCardsScanned ?? 0}
          </div>
          {result.errors.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-sm text-slate-600">
                Деталі ({result.errors.length})
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                {result.errors.slice(0, 5).map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
                {result.errors.length > 5 && <li>…</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

