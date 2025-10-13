"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  KeycrmCardSearchError,
  KeycrmCardSearchResult,
} from "@/lib/keycrm-card-search";
import type {
  KeycrmPipeline,
  KeycrmPipelineDetailError,
  KeycrmPipelineDetailResult,
  KeycrmPipelineListError,
  KeycrmPipelineListResult,
} from "@/lib/keycrm-pipelines";

const INITIAL_HINT =
  "Введіть повне ім'я або social_id (наприклад, instagram логін) чи залиште поле порожнім і оберіть воронку/статус.";

type SearchState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; result: KeycrmCardSearchResult }
  | { status: "error"; error: KeycrmCardSearchError };

export function KeycrmCardSearchWidget() {
  const [query, setQuery] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [pipelines, setPipelines] = useState<KeycrmPipeline[]>([]);
  const [statusHydration, setStatusHydration] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "error"; message: string }
  >({ state: "idle" });
  const [targetStatusHydration, setTargetStatusHydration] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "error"; message: string }
  >({ state: "idle" });
  const [pipelinesStatus, setPipelinesStatus] = useState<
    | { state: "loading" }
    | {
        state: "loaded";
        source: "remote" | "cache" | "stale";
        fetchedAt: string | null;
        note?: string;
      }
    | { state: "error"; message: string }
  >({ state: "loading" });
  const [state, setState] = useState<SearchState>({ status: "idle", message: INITIAL_HINT });
  const [targetPipelineId, setTargetPipelineId] = useState("");
  const [targetStatusId, setTargetStatusId] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [moveState, setMoveState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; message: string; response: unknown }
    | { status: "error"; message: string; details?: unknown }
  >({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const targetStatusAbortRef = useRef<AbortController | null>(null);
  const statusFetchPipelineRef = useRef<number | null>(null);
  const targetStatusFetchPipelineRef = useRef<number | null>(null);
  const failedPipelinesRef = useRef<Set<number>>(new Set());
  const lastPipelineIdRef = useRef<string>("");
  const lastTargetPipelineIdRef = useRef<string>("");

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      statusAbortRef.current?.abort();
      targetStatusAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPipelines() {
      setPipelinesStatus({ state: "loading" });
      try {
        const res = await fetch("/api/keycrm/pipelines", {
          headers: { accept: "application/json" },
        });
        const json = (await res.json().catch(() => null)) as KeycrmPipelineListResult | null;

        if (!json) {
          if (!cancelled) {
            setPipelinesStatus({ state: "error", message: "Не вдалося прочитати список воронок" });
          }
          return;
        }

        if (json.ok) {
          if (!cancelled) {
            setPipelines(json.pipelines);
            setPipelinesStatus({ state: "loaded", source: json.source, fetchedAt: json.fetchedAt });
          }
          return;
        }

        if (!cancelled) {
          const error = json as KeycrmPipelineListError;
          setPipelines(error.pipelines);
          if (error.pipelines.length) {
            setPipelinesStatus({
              state: "loaded",
              source: "stale",
              fetchedAt: error.fetchedAt,
              note:
                error.error === "keycrm_env_missing"
                  ? "KeyCRM не налаштовано. Показуємо останній кешований список."
                  : "Не вдалося оновити воронки. Показуємо кешований список.",
            });
          } else {
            setPipelinesStatus({
              state: "error",
              message: error.error === "keycrm_env_missing" ? "KeyCRM не налаштовано" : "Не вдалося отримати воронки",
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setPipelinesStatus({
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    void loadPipelines();

    return () => {
      cancelled = true;
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
      const pipelineValue = filters.pipelineId?.trim() ?? "";
      const statusValue = filters.statusId?.trim() ?? "";

      if (!trimmed && !pipelineValue) {
        setState({
          status: "error",
          error: {
            ok: false,
            error: "filters_required",
            details: "Щоб показати картки без пошукового запиту, оберіть воронку або задайте статус.",
          },
        });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMoveState({ status: "idle" });

      setState({
        status: "loading",
        message: trimmed ? "Шукаємо у KeyCRM…" : "Збираємо картки з обраної воронки…",
      });

      try {
        const params = new URLSearchParams();

        if (trimmed) {
          params.set("needle", trimmed);
        }

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
      itemsCount: result.items.length,
    };
  }, [state]);

  const match = state.status === "success" ? state.result.match : null;
  const items = state.status === "success" ? state.result.items : [];
  const needleUsed = state.status === "success" ? state.result.needle.trim() : "";
  const errorDetails = state.status === "error" ? state.error.details : undefined;
  const currentPipeline = useMemo(() => {
    if (!pipelineId) return null;
    const selected = Number(pipelineId);
    if (!Number.isFinite(selected)) return null;
    return pipelines.find((pipeline) => pipeline.id === selected) ?? null;
  }, [pipelineId, pipelines]);
  const targetPipeline = useMemo(() => {
    if (!targetPipelineId) return null;
    const selected = Number(targetPipelineId);
    if (!Number.isFinite(selected)) return null;
    return pipelines.find((pipeline) => pipeline.id === selected) ?? null;
  }, [pipelines, targetPipelineId]);

  useEffect(() => {
    if (state.status !== "success") {
      setSelectedCardId(null);
      return;
    }

    const existing = state.result.items.some((item) => item.cardId === selectedCardId);
    if (existing) {
      return;
    }

    if (state.result.match) {
      setSelectedCardId(state.result.match.cardId);
      return;
    }

    const fallbackId = state.result.items[0]?.cardId;
    setSelectedCardId(Number.isFinite(fallbackId) ? fallbackId : null);
  }, [selectedCardId, state]);

  useEffect(() => {
    if (!targetPipeline) {
      setTargetStatusId("");
      return;
    }

    if (!targetStatusId) {
      return;
    }

    const selectedStatusId = Number(targetStatusId);
    if (!Number.isFinite(selectedStatusId)) {
      setTargetStatusId("");
      return;
    }

    const exists = targetPipeline.statuses.some((status) => status.id === selectedStatusId);
    if (!exists) {
      setTargetStatusId("");
    }
  }, [targetPipeline, targetStatusId]);

  useEffect(() => {
    if (!currentPipeline) {
      setStatusId("");
      return;
    }

    if (!statusId) {
      return;
    }

    const selectedStatusId = Number(statusId);
    if (!Number.isFinite(selectedStatusId)) {
      setStatusId("");
      return;
    }

    const exists = currentPipeline.statuses.some((status) => status.id === selectedStatusId);
    if (!exists) {
      setStatusId("");
    }
  }, [currentPipeline, statusId]);

  useEffect(() => {
    const trimmed = pipelineId.trim();

    if (trimmed !== lastPipelineIdRef.current) {
      lastPipelineIdRef.current = trimmed;
      if (trimmed) {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
          failedPipelinesRef.current.delete(numeric);
        }
      }
    }

    if (!trimmed) {
      if (statusAbortRef.current) {
        statusAbortRef.current.abort();
        statusAbortRef.current = null;
      }
      statusFetchPipelineRef.current = null;
      if (statusHydration.state !== "idle") {
        setStatusHydration({ state: "idle" });
      }
      return;
    }

    const selectedId = Number(trimmed);
    if (!Number.isFinite(selectedId) || selectedId <= 0) {
      if (statusHydration.state !== "error" || statusHydration.message !== "Некоректний pipeline_id") {
        setStatusHydration({ state: "error", message: "Некоректний pipeline_id" });
      }
      return;
    }

    const pipeline = pipelines.find((item) => item.id === selectedId) ?? null;

    if (pipeline && pipeline.statuses.length > 0) {
      if (statusAbortRef.current) {
        statusAbortRef.current.abort();
        statusAbortRef.current = null;
      }
      statusFetchPipelineRef.current = null;
      failedPipelinesRef.current.delete(selectedId);
      if (statusHydration.state !== "idle") {
        setStatusHydration({ state: "idle" });
      }
      return;
    }

    if (failedPipelinesRef.current.has(selectedId) && !statusAbortRef.current) {
      return;
    }

    if (statusFetchPipelineRef.current === selectedId && statusAbortRef.current) {
      return;
    }

    const controller = new AbortController();
    if (statusAbortRef.current) {
      statusAbortRef.current.abort();
    }
    statusAbortRef.current = controller;
    statusFetchPipelineRef.current = selectedId;
    setStatusHydration({ state: "loading" });

    void (async () => {
      try {
        const res = await fetch(`/api/keycrm/pipelines?pipeline_id=${selectedId}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        const json = (await res.json().catch(() => null)) as KeycrmPipelineDetailResult | null;

        if (!json) {
          failedPipelinesRef.current.add(selectedId);
          setStatusHydration({ state: "error", message: "KeyCRM повернув порожню відповідь" });
          return;
        }

        if (json.ok) {
          setPipelines((prev) => {
            const index = prev.findIndex((item) => item.id === json.pipeline.id);
            if (index === -1) {
              return [...prev, json.pipeline].sort((a, b) => {
                const posA = a.position ?? Number.MAX_SAFE_INTEGER;
                const posB = b.position ?? Number.MAX_SAFE_INTEGER;
                if (posA === posB) {
                  return a.id - b.id;
                }
                return posA - posB;
              });
            }
            return prev.map((item, i) => (i === index ? json.pipeline : item));
          });
          failedPipelinesRef.current.delete(selectedId);
          setStatusHydration({ state: "idle" });
          return;
        }

        const error = json as KeycrmPipelineDetailError;
        if (error.pipeline) {
          setPipelines((prev) => {
            const index = prev.findIndex((item) => item.id === error.pipeline!.id);
            if (index === -1) {
              return [...prev, error.pipeline!];
            }
            return prev.map((item, i) => (i === index ? error.pipeline! : item));
          });
        }
        setStatusHydration({
          state: "error",
          message:
            error.error === "keycrm_env_missing"
              ? "KeyCRM не налаштовано"
              : error.error === "keycrm_pipeline_not_found"
                ? "Таку воронку не знайдено"
                : "Не вдалося завантажити статуси цієї воронки",
        });
        failedPipelinesRef.current.add(selectedId);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        failedPipelinesRef.current.add(selectedId);
        setStatusHydration({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (statusAbortRef.current === controller) {
          statusAbortRef.current = null;
        }
        if (statusFetchPipelineRef.current === selectedId) {
          statusFetchPipelineRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [pipelineId, pipelines, statusHydration.state]);

  useEffect(() => {
    const trimmed = targetPipelineId.trim();

    if (trimmed !== lastTargetPipelineIdRef.current) {
      lastTargetPipelineIdRef.current = trimmed;
      if (trimmed) {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
          failedPipelinesRef.current.delete(numeric);
        }
      }
    }

    if (!trimmed) {
      if (targetStatusAbortRef.current) {
        targetStatusAbortRef.current.abort();
        targetStatusAbortRef.current = null;
      }
      targetStatusFetchPipelineRef.current = null;
      if (targetStatusHydration.state !== "idle") {
        setTargetStatusHydration({ state: "idle" });
      }
      return;
    }

    const selectedId = Number(trimmed);
    if (!Number.isFinite(selectedId) || selectedId <= 0) {
      if (
        targetStatusHydration.state !== "error" ||
        targetStatusHydration.message !== "Некоректний pipeline_id"
      ) {
        setTargetStatusHydration({ state: "error", message: "Некоректний pipeline_id" });
      }
      return;
    }

    const pipeline = pipelines.find((item) => item.id === selectedId) ?? null;

    if (pipeline && pipeline.statuses.length > 0) {
      if (targetStatusAbortRef.current) {
        targetStatusAbortRef.current.abort();
        targetStatusAbortRef.current = null;
      }
      targetStatusFetchPipelineRef.current = null;
      failedPipelinesRef.current.delete(selectedId);
      if (targetStatusHydration.state !== "idle") {
        setTargetStatusHydration({ state: "idle" });
      }
      return;
    }

    if (failedPipelinesRef.current.has(selectedId) && !targetStatusAbortRef.current) {
      return;
    }

    if (targetStatusFetchPipelineRef.current === selectedId && targetStatusAbortRef.current) {
      return;
    }

    const controller = new AbortController();
    if (targetStatusAbortRef.current) {
      targetStatusAbortRef.current.abort();
    }
    targetStatusAbortRef.current = controller;
    targetStatusFetchPipelineRef.current = selectedId;
    setTargetStatusHydration({ state: "loading" });

    void (async () => {
      try {
        const res = await fetch(`/api/keycrm/pipelines?pipeline_id=${selectedId}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        const json = (await res.json().catch(() => null)) as KeycrmPipelineDetailResult | null;

        if (!json) {
          failedPipelinesRef.current.add(selectedId);
          setTargetStatusHydration({ state: "error", message: "KeyCRM повернув порожню відповідь" });
          return;
        }

        if (json.ok) {
          setPipelines((prev) => {
            const index = prev.findIndex((item) => item.id === json.pipeline.id);
            if (index === -1) {
              return [...prev, json.pipeline].sort((a, b) => {
                const posA = a.position ?? Number.MAX_SAFE_INTEGER;
                const posB = b.position ?? Number.MAX_SAFE_INTEGER;
                if (posA === posB) {
                  return a.id - b.id;
                }
                return posA - posB;
              });
            }
            return prev.map((item, i) => (i === index ? json.pipeline : item));
          });
          failedPipelinesRef.current.delete(selectedId);
          setTargetStatusHydration({ state: "idle" });
          return;
        }

        const error = json as KeycrmPipelineDetailError;
        if (error.pipeline) {
          setPipelines((prev) => {
            const index = prev.findIndex((item) => item.id === error.pipeline!.id);
            if (index === -1) {
              return [...prev, error.pipeline!];
            }
            return prev.map((item, i) => (i === index ? error.pipeline! : item));
          });
        }
        setTargetStatusHydration({
          state: "error",
          message:
            error.error === "keycrm_env_missing"
              ? "KeyCRM не налаштовано"
              : error.error === "keycrm_pipeline_not_found"
                ? "Таку воронку не знайдено"
                : "Не вдалося завантажити статуси цієї воронки",
        });
        failedPipelinesRef.current.add(selectedId);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        failedPipelinesRef.current.add(selectedId);
        setTargetStatusHydration({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (targetStatusAbortRef.current === controller) {
          targetStatusAbortRef.current = null;
        }
        if (targetStatusFetchPipelineRef.current === selectedId) {
          targetStatusFetchPipelineRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [pipelines, targetPipelineId, targetStatusHydration.state]);

  const selectedCard = useMemo(() => {
    if (!selectedCardId || state.status !== "success") return null;
    return state.result.items.find((item) => item.cardId === selectedCardId) ?? null;
  }, [selectedCardId, state]);

  const handleMove = useCallback(async () => {
    if (!selectedCardId) {
      setMoveState({ status: "error", message: "Оберіть картку для переміщення" });
      return;
    }

    const trimmedPipeline = targetPipelineId.trim();
    const trimmedStatus = targetStatusId.trim();

    if (!trimmedPipeline || !trimmedStatus) {
      setMoveState({ status: "error", message: "Оберіть цільову воронку та статус" });
      return;
    }

    setMoveState({ status: "loading" });

    try {
      const res = await fetch("/api/keycrm/card/move", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          card_id: String(selectedCardId),
          to_pipeline_id: trimmedPipeline,
          to_status_id: trimmedStatus,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok: true; [key: string]: unknown }
        | { ok: false; error?: string; [key: string]: unknown }
        | null;

      if (!json) {
        setMoveState({ status: "error", message: "KeyCRM повернув неочікувану відповідь" });
        return;
      }

      if (json.ok) {
        setMoveState({ status: "success", message: "Картку успішно переміщено", response: json });
        return;
      }

      setMoveState({
        status: "error",
        message: (json as { error?: string }).error ?? "KeyCRM відхилив переміщення",
        details: json,
      });
    } catch (err) {
      setMoveState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [selectedCardId, targetPipelineId, targetStatusId]);

  const moveDisabled =
    !selectedCardId ||
    !targetPipelineId.trim() ||
    !targetStatusId.trim() ||
    moveState.status === "loading";

  const pipelineHelperText = useMemo(() => {
    if (pipelinesStatus.state === "loading") {
      return "Завантажуємо воронки з KeyCRM…";
    }
    if (pipelinesStatus.state === "error") {
      return `Не вдалося отримати воронки: ${pipelinesStatus.message}`;
    }
    if (pipelinesStatus.state === "loaded") {
      if (pipelinesStatus.note) {
        return pipelinesStatus.note;
      }
      if (pipelinesStatus.source === "stale") {
        return "Показуємо кешований список воронок (оновлення наразі недоступне)";
      }
    }
    return null;
  }, [pipelinesStatus]);

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
            <span className="mb-1 font-medium">Воронка</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              name="pipeline_id"
              value={pipelineId}
              onChange={(event) => {
                setPipelineId(event.target.value);
                setStatusId("");
              }}
              disabled={pipelinesStatus.state === "loading" && !pipelines.length}
            >
              <option value="">Усі воронки</option>
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 font-medium">Статус</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              name="status_id"
              value={statusId}
              onChange={(event) => setStatusId(event.target.value)}
              disabled={
                !currentPipeline ||
                statusHydration.state === "loading" ||
                currentPipeline.statuses.length === 0
              }
            >
              <option value="">Усі статуси</option>
              {currentPipeline?.statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.title}
                </option>
              ))}
            </select>
            {statusHydration.state === "loading" && (
              <span className="mt-1 text-xs text-slate-500">Завантажуємо статуси…</span>
            )}
            {statusHydration.state === "error" && (
              <span className="mt-1 text-xs text-red-600">{statusHydration.message}</span>
            )}
          </label>
        </div>

        <div className="grid gap-3 rounded-lg border border-indigo-100 bg-indigo-50/70 p-3 text-sm text-indigo-900 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-indigo-700">
              Цільова воронка
            </span>
            <select
              className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              name="target_pipeline_id"
              value={targetPipelineId}
              onChange={(event) => {
                setTargetPipelineId(event.target.value);
                setTargetStatusId("");
              }}
            >
              <option value="">Не обрано</option>
              {pipelines.map((pipeline) => (
                <option key={`target-${pipeline.id}`} value={pipeline.id}>
                  {pipeline.title} (#{pipeline.id})
                </option>
              ))}
            </select>
            {targetStatusHydration.state === "loading" && (
              <span className="text-xs text-indigo-700">Завантажуємо статуси цієї воронки…</span>
            )}
            {targetStatusHydration.state === "error" && (
              <span className="text-xs text-red-600">{targetStatusHydration.message}</span>
            )}
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-indigo-700">
              Цільовий статус
            </span>
            <select
              className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              name="target_status_id"
              value={targetStatusId}
              onChange={(event) => setTargetStatusId(event.target.value)}
              disabled={!targetPipeline || targetStatusHydration.state === "loading"}
            >
              <option value="">Не обрано</option>
              {(targetPipeline?.statuses ?? []).map((status) => (
                <option key={`target-status-${status.id}`} value={status.id}>
                  {status.title} (#{status.id})
                </option>
              ))}
            </select>
            {targetPipeline && targetPipeline.statuses.length === 0 && targetStatusHydration.state === "idle" && (
              <span className="text-xs text-indigo-700">Для цієї воронки статуси ще не завантажені.</span>
            )}
          </div>
        </div>

        {pipelineHelperText && (
          <p className="text-xs text-slate-500">{pipelineHelperText}</p>
        )}
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
          {(match || needleUsed) && (
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
          )}

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
              <div>
                <span className="font-medium text-slate-900">Отримано карток:</span> {resultMeta.itemsCount}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">
                {needleUsed
                  ? "Картки, що відповідали фільтрам"
                  : "Картки у вибраній воронці та статусі"}
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
                  <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Обрати</th>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">Назва</th>
                      <th className="px-3 py-2">Контакт</th>
                      <th className="px-3 py-2">Соцмережа</th>
                      <th className="px-3 py-2">Воронка</th>
                      <th className="px-3 py-2">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {items.map((item) => (
                      <tr
                        key={item.cardId}
                        className={`cursor-pointer hover:bg-slate-50 ${
                          selectedCardId === item.cardId ? "bg-indigo-50/70" : ""
                        }`}
                        onClick={() => setSelectedCardId(item.cardId)}
                      >
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="radio"
                            name="selected_card"
                            className="h-4 w-4 accent-indigo-600"
                            checked={selectedCardId === item.cardId}
                            onChange={() => setSelectedCardId(item.cardId)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">#{item.cardId}</td>
                        <td className="px-3 py-2 text-slate-900">{item.title ?? "—"}</td>
                        <td className="px-3 py-2">{item.contactName ?? item.clientName ?? "—"}</td>
                        <td className="px-3 py-2">{item.contactSocialId ?? item.clientSocialId ?? "—"}</td>
                        <td className="px-3 py-2">
                          {(() => {
                            if (item.pipelineTitle) return item.pipelineTitle;
                            const pipeline = pipelines.find((pipeline) => pipeline.id === item.pipelineId);
                            return pipeline?.title ?? "—";
                          })()}
                        </td>
                        <td className="px-3 py-2">
                          {(() => {
                            if (item.statusTitle) return item.statusTitle;
                            const pipeline = pipelines.find((pipeline) => pipeline.id === item.pipelineId);
                            if (!pipeline) return "—";
                            const status = pipeline.statuses.find((status) => status.id === item.statusId);
                            return status?.title ?? "—";
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-indigo-900">Переміщення картки</h3>
            <p className="text-xs text-slate-600">
              Оберіть картку у таблиці вище та цільову воронку зі статусом. Після переміщення
              картка з’явиться у вибраній колонці KeyCRM.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-700">
                {selectedCard ? (
                  <>
                    <span className="font-medium text-slate-900">Вибрана картка:</span>{" "}
                    #{selectedCard.cardId} · {selectedCard.title ?? "Без назви"}
                  </>
                ) : (
                  <span className="text-slate-500">Картку не обрано</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleMove}
                disabled={moveDisabled}
                className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                  moveDisabled
                    ? "cursor-not-allowed bg-indigo-200 text-indigo-500"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {moveState.status === "loading" ? "Переміщуємо…" : "Перемістити картку"}
              </button>
            </div>

            {moveState.status === "error" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p className="font-semibold">Не вдалося перемістити</p>
                <p className="mt-1 text-xs text-red-600">{moveState.message}</p>
                {moveState.details && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-xs text-red-800">
                    {JSON.stringify(moveState.details, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {moveState.status === "success" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <p className="font-semibold">{moveState.message}</p>
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-xs text-emerald-900">
                  {JSON.stringify(moveState.response, null, 2)}
                </pre>
              </div>
            )}
          </div>

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
