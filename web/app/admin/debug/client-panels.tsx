'use client';

import { useState } from 'react';

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
