"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  KeycrmCardSearchError,
  KeycrmCardSearchResult,
} from "@/lib/keycrm-card-search";

const INITIAL_HINT =
  "Введіть повне ім'я або social_id (наприклад, instagram логін) та натисніть пошук.";

type SearchState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; result: KeycrmCardSearchResult }
  | { status: "error"; error: KeycrmCardSearchError };

export function KeycrmCardSearchWidget() {
  const [query, setQuery] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle", message: INITIAL_HINT });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runSearch = useCallback(
    async (
      needle: string,
      filters: {
        pipelineId?: string;
        statusId?: string;
      } = {}
    ) => {
      const trimmed = needle.trim();
      if (!trimmed) {
        setState({ status: "idle", message: INITIAL_HINT });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ status: "loading", message: "Шукаємо у KeyCRM…" });

      try {
        const params = new URLSearchParams({ needle: trimmed });
        const pipelineValue = filters.pipelineId?.trim();
        const statusValue = filters.statusId?.trim();

        if (pipelineValue) {
          params.set("pipeline_id", pipelineValue);
        }

        if (statusValue) {
          params.set("status_id", statusValue);
        }

        const res = await fetch(`/api/keycrm/card/find?${params.toString()}`, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
          },
        });

        const json = (await res.json().catch(() => null)) as
          | KeycrmCardSearchResult
          | KeycrmCardSearchError
          | null;

        if (!json) {
          setState({
            status: "error",
            error: { ok: false, error: "invalid_response", details: "Відповідь API не JSON" },
          });
          return;
        }

        if ("ok" in json && json.ok === true) {
          setState({ status: "success", result: json });
          return;
        }

        setState({ status: "error", error: json as KeycrmCardSearchError });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        setState({
          status: "error",
          error: {
            ok: false,
            error: "network_error",
            details: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    []
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const value = String(formData.get("needle") ?? "");
      const pipelineValue = String(formData.get("pipeline_id") ?? "");
      const statusValue = String(formData.get("status_id") ?? "");
      void runSearch(value, { pipelineId: pipelineValue, statusId: statusValue });
    },
    [runSearch]
  );

  const resultMeta = useMemo(() => {
    if (state.status !== "success") return null;
    const result = state.result;
    return {
      cardsChecked: result.cardsChecked,
      pagesScanned: result.pagesScanned,
      pipelineId: result.filters.pipelineId,
      statusId: result.filters.statusId,
      perPage: result.filters.perPage,
      maxPages: result.filters.maxPages,
    };
  }, [state]);

  const match = state.status === "success" ? state.result.match : null;
  const errorDetails = state.status === "error" ? state.error.details : undefined;

  return (
    <div className="space-y-4">
      <form className="flex flex-col gap-4 rounded-xl bg-slate-50 p-4 shadow-inner" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm text-slate-700">
            <span className="mb-1 block font-medium">Пошук у KeyCRM</span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              type="text"
              name="needle"
              value={query}
              placeholder="Наприклад: Viktoria Kolachnyk або kolachnyk.v"
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {state.status === "loading" ? "Шукаємо…" : "Знайти картку"}
          </button>
        </div>

        <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <label className="flex flex-col">
            <span className="mb-1 font-medium">pipeline_id (воронка)</span>
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              type="number"
              name="pipeline_id"
              value={pipelineId}
              onChange={(event) => setPipelineId(event.target.value)}
              placeholder="Напр. 1"
              min={0}
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 font-medium">status_id (статус)</span>
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              type="number"
              name="status_id"
              value={statusId}
              onChange={(event) => setStatusId(event.target.value)}
              placeholder="Напр. 38"
              min={0}
            />
          </label>
        </div>
      </form>

      {state.status === "idle" && <p className="text-sm text-slate-500">{state.message}</p>}

      {state.status === "loading" && <p className="text-sm text-slate-500">{state.message}</p>}

      {state.status === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Помилка пошуку</p>
          <p className="mt-1 break-words">Код: {state.error.error}</p>
          {state.error.error === "keycrm_rate_limited" && (
            <p className="mt-2 text-xs text-red-600">
              KeyCRM повернув обмеження 429. Задайте воронку та статус або повторіть спробу пізніше.
            </p>
          )}
          {errorDetails !== undefined && errorDetails !== null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-3 text-xs text-red-800">
              {typeof errorDetails === "string"
                ? errorDetails
                : JSON.stringify(errorDetails, null, 2)}
            </pre>
          )}
        </div>
      )}

      {state.status === "success" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {match ? (
              <div className="space-y-1">
                <p className="text-base font-semibold text-emerald-900">
                  Знайдено картку #{match.cardId}
                </p>
                {match.title && <p className="text-sm">Назва: {match.title}</p>}
                <p className="text-sm">
                  Збіг у полі <code>{match.matchedField}</code> зі значенням "{match.matchedValue ?? ""}".
                </p>
              </div>
            ) : (
              <p className="font-semibold">Збігів не знайдено.</p>
            )}
          </div>

          {resultMeta && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 sm:grid-cols-3">
              <div>
                <span className="font-medium text-slate-900">Перевірено карток:</span> {resultMeta.cardsChecked}
              </div>
              <div>
                <span className="font-medium text-slate-900">Сторінок проглянуто:</span> {resultMeta.pagesScanned}
              </div>
              <div>
                <span className="font-medium text-slate-900">Запит (per_page × max_pages):</span> {resultMeta.perPage} × {resultMeta.maxPages}
              </div>
              <div>
                <span className="font-medium text-slate-900">pipeline_id:</span> {resultMeta.pipelineId ?? "—"}
              </div>
              <div>
                <span className="font-medium text-slate-900">status_id:</span> {resultMeta.statusId ?? "—"}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-700">Сира відповідь API</h3>
            <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
              {JSON.stringify(state.result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
