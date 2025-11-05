"use client";

import { useState } from "react";

type CleanupSummary = {
  ok: boolean;
  deletedIds: number;
  deletedKeys: number;
  sampleIds: string[];
  sources: Record<string, number>;
};

type CleanupState = {
  loading: boolean;
  status: number | null;
  result: CleanupSummary | null;
  error: string | null;
};

const INITIAL_STATE: CleanupState = {
  loading: false,
  status: null,
  result: null,
  error: null,
};

export function CampaignsMaintenanceCard() {
  const [state, setState] = useState<CleanupState>(INITIAL_STATE);

  const runCleanup = async () => {
    setState({ loading: true, status: null, result: null, error: null });
    try {
      const res = await fetch("/api/campaigns/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        const message = json?.error ? String(json.error) : `HTTP ${res.status}`;
        setState({ loading: false, status: res.status, result: null, error: message });
        return;
      }
      const summary: CleanupSummary = {
        ok: Boolean(json.ok),
        deletedIds: Number(json.deletedIds ?? 0),
        deletedKeys: Number(json.deletedKeys ?? 0),
        sampleIds: Array.isArray(json.sampleIds) ? json.sampleIds : [],
        sources: json.sources && typeof json.sources === "object" ? json.sources : {},
      };
      setState({ loading: false, status: res.status, result: summary, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ loading: false, status: null, result: null, error: message });
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Очищення кампаній у KV</h2>
          <p className="mt-2 text-sm text-slate-500">
            Видаляє всі збережені кампанії з Vercel KV і очищає кеш у пам&apos;яті. Використовуйте, коли
            потрібно створити кампанії з нуля.
          </p>
        </div>
        <button
          type="button"
          onClick={runCleanup}
          disabled={state.loading}
          className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-wait disabled:opacity-50"
        >
          {state.loading ? "Очищення…" : "Видалити всі"}
        </button>
      </div>

      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        Операція незворотна. Після очищення потрібно заново створити кампанії в адмінці.
      </p>

      {state.error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Помилка: {state.error}
        </div>
      )}

      {state.result && (
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="font-medium text-slate-800">Видалено карток:</span> {state.result.deletedIds}
            </div>
            <div>
              <span className="font-medium text-slate-800">Очищено ключів:</span> {state.result.deletedKeys}
            </div>
          </div>
          {state.result.sampleIds.length > 0 && (
            <div>
              <span className="font-medium text-slate-800">Приклади ID:</span>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(state.result.sampleIds, null, 2)}
              </pre>
            </div>
          )}
          {Object.keys(state.result.sources).length > 0 && (
            <div>
              <span className="font-medium text-slate-800">Джерела ID:</span>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(state.result.sources, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
