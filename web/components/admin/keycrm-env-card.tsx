"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PingInfo = {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  endpoint: string | null;
  error: string | null;
};

type StatusResponse = {
  ok: boolean;
  timestamp: string;
  keycrm: {
    hasBaseUrl: boolean;
    hasToken: boolean;
    baseUrl: string | null;
    ping: PingInfo;
  };
};

type FetchState = {
  loading: boolean;
  error: string | null;
  status: StatusResponse | null;
};

const INITIAL_STATE: FetchState = {
  loading: false,
  error: null,
  status: null,
};

export function KeycrmEnvCard() {
  const [state, setState] = useState<FetchState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/admin/status", {
        method: "GET",
        cache: "no-store",
      });
      const json: StatusResponse = await res.json();
      setState({
        loading: false,
        error: res.ok ? null : `HTTP ${res.status}`,
        status: json,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ loading: false, error: message, status: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ping = state.status?.keycrm.ping;
  const pingClassName = useMemo(() => {
    if (!ping?.attempted) return "text-slate-600";
    return ping.ok ? "text-emerald-600" : "text-amber-600";
  }, [ping]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Статус KeyCRM API</h2>
          <p className="mt-2 text-sm text-slate-500">
            Перевіряємо наявність обов&apos;язкових змінних середовища і робимо тестовий запит до
            KeyCRM, щоб впевнитися, що ми можемо виконувати операції переміщення карток.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={state.loading}
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
        >
          {state.loading ? "Оновлення…" : "Оновити"}
        </button>
      </div>

      {state.error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Помилка запиту: {state.error}
        </div>
      )}

      <dl className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-slate-700">KEYCRM_API_URL / KEYCRM_BASE_URL</dt>
          <dd>{state.status?.keycrm.hasBaseUrl ? "налаштовано" : "не задано"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">KEYCRM_API_TOKEN / KEYCRM_BEARER</dt>
          <dd>{state.status?.keycrm.hasToken ? "налаштовано" : "не задано"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Остання перевірка</dt>
          <dd>{state.status?.timestamp ? new Date(state.status.timestamp).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Результат ping</dt>
          <dd className={pingClassName}>
            {ping?.attempted
              ? ping.ok
                ? `OK (${ping.status ?? "?"})`
                : `Помилка ${ping.status ?? ""}`
              : "не виконувався"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-2 text-xs text-slate-600">
        {ping?.endpoint && (
          <p>
            <span className="font-medium text-slate-700">URL перевірки:</span> {ping.endpoint}
          </p>
        )}
        {ping?.error && (
          <p className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            {ping.error}
          </p>
        )}
        {!ping?.attempted && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            Щоб виконати перевірку, заповніть KEYCRM_API_URL та KEYCRM_API_TOKEN у середовищі. Після
            цього натисніть «Оновити».
          </p>
        )}
      </div>
    </section>
  );
}
