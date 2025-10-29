'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type JsonValue = any;

type FetchState = {
  loading: boolean;
  data: JsonValue | null;
  error: string | null;
};

function useFetchState(initial?: JsonValue): [FetchState, {
  start: () => void;
  succeed: (data: JsonValue) => void;
  fail: (error: string) => void;
  reset: () => void;
}] {
  const [state, setState] = useState<FetchState>({
    loading: false,
    data: initial ?? null,
    error: null,
  });

  return [
    state,
    {
      start: () => setState((s) => ({ ...s, loading: true, error: null })),
      succeed: (data) => setState({ loading: false, data, error: null }),
      fail: (error) => setState({ loading: false, data: null, error }),
      reset: () => setState({ loading: false, data: null, error: null }),
    },
  ];
}

function JsonView({ value }: { value: JsonValue }) {
  if (value == null) {
    return <p className="text-sm text-slate-500">Немає даних.</p>;
  }

  let pretty = '';
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch (e) {
    pretty = String(value);
  }

  return (
    <pre className="max-h-96 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
      {pretty}
    </pre>
  );
}

export function KeycrmSearchPanel() {
  const [username, setUsername] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [perPage, setPerPage] = useState('50');
  const [maxPages, setMaxPages] = useState('20');
  const [delayMs, setDelayMs] = useState('250');
  const [state, ctrl] = useFetchState();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    ctrl.start();
    try {
      const qs = new URLSearchParams();
      qs.set('social_id', username.trim());
      if (pipelineId) qs.set('pipeline_id', pipelineId.trim());
      if (statusId) qs.set('status_id', statusId.trim());
      if (perPage) qs.set('per_page', perPage.trim());
      if (maxPages) qs.set('max_pages', maxPages.trim());
      if (delayMs) qs.set('delay_ms', delayMs.trim());

      const res = await fetch(`/api/keycrm/card/by-social?${qs.toString()}`, {
        cache: 'no-store',
        headers: { 'x-requested-with': 'debug-panel' },
      });
      const json = await res.json();
      if (!res.ok) {
        ctrl.fail(json?.error || `HTTP ${res.status}`);
        return;
      }
      ctrl.succeed(json);
    } catch (err: any) {
      ctrl.fail(err?.message || String(err));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Instagram username</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="viktoriak"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Pipeline ID</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              placeholder="1"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Status ID</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              placeholder="38"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">per_page</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={perPage}
              onChange={(e) => setPerPage(e.target.value)}
              placeholder="50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">max_pages</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              placeholder="20"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Затримка між запитами (ms)</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={delayMs}
              onChange={(e) => setDelayMs(e.target.value)}
              placeholder="250"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            disabled={state.loading}
          >
            {state.loading ? 'Пошук…' : 'Знайти картку'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            onClick={() => ctrl.reset()}
            disabled={state.loading}
          >
            Очистити
          </button>
        </div>
      </form>
      {state.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Помилка: {state.error}
        </div>
      )}
      {state.data && (
        <div>
          <JsonView value={state.data} />
        </div>
      )}
    </div>
  );
}

export function KeycrmInspectPanel() {
  const [cardId, setCardId] = useState('');
  const [state, ctrl] = useFetchState();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cardId.trim()) return;
    ctrl.start();
    try {
      const url = `/api/keycrm/inspect-card?card_id=${encodeURIComponent(cardId.trim())}`;
      const res = await fetch(url, { cache: 'no-store', headers: { 'x-requested-with': 'debug-panel' } });
      const json = await res.json();
      if (!res.ok) {
        ctrl.fail(json?.error || `HTTP ${res.status}`);
        return;
      }
      ctrl.succeed(json);
    } catch (err: any) {
      ctrl.fail(err?.message || String(err));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500">Card ID</span>
          <input
            className="w-48 rounded-lg border border-slate-200 px-3 py-2"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            placeholder="123456"
            required
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
          disabled={state.loading}
        >
          {state.loading ? 'Завантаження…' : 'Перевірити картку'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          onClick={() => ctrl.reset()}
          disabled={state.loading}
        >
          Очистити
        </button>
      </form>
      {state.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Помилка: {state.error}
        </div>
      )}
      {state.data && <JsonView value={state.data} />}
    </div>
  );
}

export function ManychatNormalizePanel() {
  const [payload, setPayload] = useState('');
  const [state, ctrl] = useFetchState();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    ctrl.start();
    try {
      const body = payload.trim() ? JSON.parse(payload) : {};
      const res = await fetch('/api/map/ig', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'debug-panel' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        ctrl.fail(json?.error || `HTTP ${res.status}`);
        return;
      }
      ctrl.succeed(json);
    } catch (err: any) {
      ctrl.fail(err?.message || String(err));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500">JSON-пейлоад ManyChat</span>
          <textarea
            className="min-h-[140px] rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder='{"username":"...","text":"...","full_name":"..."}'
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            disabled={state.loading}
          >
            {state.loading ? 'Нормалізуємо…' : 'Нормалізувати'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            onClick={() => setPayload('')}
            disabled={state.loading}
          >
            Очистити поле
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            onClick={() => ctrl.reset()}
            disabled={state.loading}
          >
            Очистити результат
          </button>
        </div>
      </form>
      {state.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Помилка: {state.error}
        </div>
      )}
      {state.data && <JsonView value={state.data} />}
    </div>
  );
}

type PipelineOption = { id: string; name: string };
type StatusOption = { id: string; pipeline_id: string; title: string };

const EMPTY_OPTION: PipelineOption[] = [];

async function fetchJson<T = any>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(typeof error === 'string' ? error : String(error));
  }
  return (json ?? {}) as T;
}

export function KeycrmManualMovePanel() {
  const [pipelines, setPipelines] = useState<PipelineOption[]>(EMPTY_OPTION);
  const [pipelinesError, setPipelinesError] = useState<string | null>(null);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);

  const [statusCache, setStatusCache] = useState<Record<string, StatusOption[]>>({});
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string | null>>({});

  const [searchValue, setSearchValue] = useState('');
  const [searchPipeline, setSearchPipeline] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  const [targetPipeline, setTargetPipeline] = useState('');
  const [targetStatus, setTargetStatus] = useState('');

  const [perPage, setPerPage] = useState('50');
  const [maxPages, setMaxPages] = useState('40');

  const [searchState, searchCtrl] = useFetchState();
  const [moveState, moveCtrl] = useFetchState();

  // Завантажуємо список воронок один раз.
  useEffect(() => {
    let cancelled = false;
    async function loadPipelines() {
      setPipelinesLoading(true);
      setPipelinesError(null);
      try {
        const json = await fetchJson<{ ok?: boolean; data?: PipelineOption[]; [key: string]: any }>(
          '/api/keycrm/pipelines',
          {
            cache: 'no-store',
            headers: { 'x-requested-with': 'debug-panel' },
          },
        );
        const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? (json as any) : [];
        if (!cancelled) {
          const normalized = (arr as PipelineOption[])
            .map((p) => ({
              id: String((p as any).id ?? ''),
              name: String(
                (p as any).name ??
                  (p as any).title ??
                  (p as any).label ??
                  (p as any).slug ??
                  (p as any).id ??
                  '',
              ),
            }))
            .filter((p) => p.id && p.name);
          setPipelines(normalized);
        }
      } catch (err: any) {
        if (!cancelled) setPipelinesError(err?.message || String(err));
      } finally {
        if (!cancelled) setPipelinesLoading(false);
      }
    }
    loadPipelines();
    return () => {
      cancelled = true;
    };
  }, []);

  // Допоміжна функція для завантаження статусів (усіх або для конкретної воронки).
  const ensureStatuses = useCallback(async (pipelineId: string | null) => {
    const key = pipelineId && pipelineId.length ? pipelineId : '__all__';
    if (statusCache[key] || statusLoading[key]) return;
    setStatusLoading((prev) => ({ ...prev, [key]: true }));
    setStatusErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const url = pipelineId && pipelineId.length
        ? `/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pipelineId)}`
        : '/api/keycrm/statuses';
      const json = await fetchJson<any>(url, {
        cache: 'no-store',
        headers: { 'x-requested-with': 'debug-panel' },
      });
      const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const normalized = (arr as StatusOption[]).map((s) => ({
        id: String((s as any).id ?? ''),
        pipeline_id: String((s as any).pipeline_id ?? ''),
        title: String((s as any).title ?? (s as any).name ?? ''),
      })).filter((s) => s.id);
      setStatusCache((prev) => ({ ...prev, [key]: normalized }));
    } catch (err: any) {
      setStatusErrors((prev) => ({ ...prev, [key]: err?.message || String(err) }));
    } finally {
      setStatusLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [statusCache, statusLoading]);

  useEffect(() => {
    ensureStatuses(null).catch(() => {});
  }, [ensureStatuses]);

  useEffect(() => {
    if (searchPipeline) ensureStatuses(searchPipeline).catch(() => {});
  }, [ensureStatuses, searchPipeline]);

  useEffect(() => {
    if (targetPipeline) ensureStatuses(targetPipeline).catch(() => {});
  }, [ensureStatuses, targetPipeline]);

  const searchStatusesList = useMemo(() => {
    if (searchPipeline) return statusCache[searchPipeline] || [];
    return statusCache['__all__'] || [];
  }, [searchPipeline, statusCache]);

  const targetStatusesList = useMemo(() => {
    if (!targetPipeline) return [];
    return statusCache[targetPipeline] || [];
  }, [statusCache, targetPipeline]);

  const onSearchSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = searchValue.trim();
    if (!query) return;
    searchCtrl.start();
    moveCtrl.reset();
    try {
      const qs = new URLSearchParams();
      qs.set('full_name', query);
      if (searchPipeline) qs.set('pipeline_id', searchPipeline);
      if (searchStatus) qs.set('status_id', searchStatus);
      if (perPage) qs.set('per_page', perPage);
      if (maxPages) qs.set('max_pages', maxPages);

      const json = await fetchJson(`/api/keycrm/ops/find-by-title?${qs.toString()}`, {
        cache: 'no-store',
        headers: { 'x-requested-with': 'debug-panel' },
      });
      searchCtrl.succeed(json);
      const found = (json as any)?.found;
      const foundPipeline = found?.pipeline_id != null ? String(found.pipeline_id) : '';
      const foundStatus = found?.status_id != null ? String(found.status_id) : '';
      if (foundPipeline) {
        setTargetPipeline(foundPipeline);
        ensureStatuses(foundPipeline).catch(() => {});
      }
      if (foundStatus) setTargetStatus(foundStatus);
    } catch (err: any) {
      searchCtrl.fail(err?.message || String(err));
    }
  };

  const foundCardId = useMemo(() => {
    const data = searchState.data as any;
    if (!data) return null;
    if (data.found_card_id) return String(data.found_card_id);
    if (data.found?.id) return String(data.found.id);
    return null;
  }, [searchState.data]);

  const onMoveClick = async () => {
    if (!foundCardId || !targetPipeline || !targetStatus) return;
    moveCtrl.start();
    try {
      const json = await fetchJson('/api/keycrm/card/move', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'debug-panel',
        },
        body: JSON.stringify({
          card_id: foundCardId,
          to_pipeline_id: targetPipeline,
          to_status_id: targetStatus,
        }),
      });
      moveCtrl.succeed(json);
    } catch (err: any) {
      moveCtrl.fail(err?.message || String(err));
    }
  };

  const pipelinesSorted = useMemo(() => {
    return [...pipelines].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  }, [pipelines]);

  const formatStatus = (status: StatusOption) => {
    return status.title || `#${status.id}`;
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSearchSubmit} className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Пошук у KeyCRM</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Приклад: Viktoria Kolachnyk або kolachnyk.v"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Воронка (для пошуку)</span>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={searchPipeline}
              onChange={(e) => {
                setSearchPipeline(e.target.value);
                setSearchStatus('');
              }}
            >
              <option value="">Усі воронки</option>
              {pipelinesSorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Статус (для пошуку)</span>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={searchStatus}
              onChange={(e) => setSearchStatus(e.target.value)}
              disabled={!searchPipeline && !searchStatusesList.length}
            >
              <option value="">Усі статуси</option>
              {searchStatusesList.map((s) => (
                <option key={`${s.pipeline_id}-${s.id}`} value={s.id}>
                  {formatStatus(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">per_page</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={perPage}
              onChange={(e) => setPerPage(e.target.value)}
              placeholder="50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">max_pages</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              placeholder="40"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            disabled={searchState.loading}
          >
            {searchState.loading ? 'Шукаємо…' : 'Знайти картку'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            onClick={() => {
              setSearchValue('');
              setSearchPipeline('');
              setSearchStatus('');
              setPerPage('50');
              setMaxPages('40');
              searchCtrl.reset();
              moveCtrl.reset();
            }}
            disabled={searchState.loading}
          >
            Очистити форму
          </button>
        </div>
        {pipelinesLoading && (
          <p className="text-xs text-slate-500">Завантажуємо воронки…</p>
        )}
        {pipelinesError && (
          <p className="text-xs text-rose-600">Не вдалося завантажити воронки: {pipelinesError}</p>
        )}
        {searchPipeline && statusLoading[searchPipeline] && (
          <p className="text-xs text-slate-500">Завантажуємо статуси для обраної воронки…</p>
        )}
        {searchPipeline && statusErrors[searchPipeline] && (
          <p className="text-xs text-rose-600">Помилка статусів: {statusErrors[searchPipeline]}</p>
        )}
        {!searchPipeline && statusErrors['__all__'] && (
          <p className="text-xs text-rose-600">Помилка статусів: {statusErrors['__all__']}</p>
        )}
      </form>

      {searchState.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Помилка пошуку: {searchState.error}
        </div>
      )}

      {searchState.data && (
        <div className="space-y-3">
          {foundCardId ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Знайдено картку <span className="font-semibold">#{foundCardId}</span>.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Картку не знайдено. Перевір параметри пошуку.
            </div>
          )}
          <JsonView value={searchState.data} />
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 p-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-slate-700">Переміщення картки</h4>
          <p className="text-xs text-slate-500">
            Обери цільову воронку та статус, щоб вручну перемістити знайдену картку.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Цільова воронка</span>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={targetPipeline}
              onChange={(e) => {
                const next = e.target.value;
                setTargetPipeline(next);
                setTargetStatus('');
                if (next) ensureStatuses(next).catch(() => {});
              }}
              disabled={!foundCardId}
            >
              <option value="">Оберіть воронку</option>
              {pipelinesSorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-500">Цільовий статус</span>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value)}
              disabled={!foundCardId || !targetPipeline || (!targetStatusesList.length && !!targetPipeline)}
            >
              <option value="">Оберіть статус</option>
              {targetStatusesList.map((s) => (
                <option key={`${s.pipeline_id}-${s.id}`} value={s.id}>
                  {formatStatus(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {targetPipeline && statusLoading[targetPipeline] && (
          <p className="text-xs text-slate-500">Завантажуємо статуси для цільової воронки…</p>
        )}
        {targetPipeline && statusErrors[targetPipeline] && (
          <p className="text-xs text-rose-600">Помилка статусів: {statusErrors[targetPipeline]}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
            onClick={onMoveClick}
            disabled={!foundCardId || !targetPipeline || !targetStatus || moveState.loading}
          >
            {moveState.loading ? 'Переміщуємо…' : 'Перемістити картку'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            onClick={() => {
              setTargetPipeline('');
              setTargetStatus('');
              moveCtrl.reset();
            }}
            disabled={moveState.loading}
          >
            Очистити налаштування
          </button>
        </div>
        {!foundCardId && (
          <p className="text-xs text-slate-500">Щоб активувати переміщення, спочатку знайди картку.</p>
        )}
        {moveState.error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Помилка переміщення: {moveState.error}
          </div>
        )}
        {moveState.data && <JsonView value={moveState.data} />}
      </div>
    </div>
  );
}
