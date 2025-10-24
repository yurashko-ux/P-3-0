'use client';

import * as React from 'react';

type ApiCall = {
  ok: boolean;
  status: number;
  method: string;
  url: string;
  durationMs: number;
  body?: unknown;
  text?: string;
  error?: string;
  timestamp: number;
};

type Pipeline = { id: string; name: string };
type Status = { id: string; name: string };

const DEFAULT_MC_PAYLOAD = `{
  "event": "ig_comment",
  "data": {
    "user": {
      "username": "insta.user",
      "name": "Insta User"
    },
    "message": {
      "text": "v1 Привіт!"
    }
  }
}`;

function formatJson(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function callJson(url: string, init?: RequestInit): Promise<ApiCall> {
  const started = performance.now ? performance.now() : Date.now();
  const method = (init?.method || 'GET').toUpperCase();
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const duration = (performance.now ? performance.now() : Date.now()) - started;
    return {
      ok: res.ok,
      status: res.status,
      method,
      url,
      durationMs: Math.round(duration),
      body,
      text,
      timestamp: Date.now(),
    };
  } catch (error: any) {
    const duration = (performance.now ? performance.now() : Date.now()) - started;
    return {
      ok: false,
      status: 0,
      method,
      url,
      durationMs: Math.round(duration),
      error: error?.message || String(error),
      timestamp: Date.now(),
    };
  }
}

export default function AdminDebugClient() {
  const [mcPayload, setMcPayload] = React.useState(DEFAULT_MC_PAYLOAD);
  const [mcResult, setMcResult] = React.useState<ApiCall | null>(null);
  const [mcError, setMcError] = React.useState<string | null>(null);
  const [mcLoading, setMcLoading] = React.useState(false);

  const [cardId, setCardId] = React.useState('');
  const [pipelineId, setPipelineId] = React.useState('');
  const [statusId, setStatusId] = React.useState('');
  const [dryRun, setDryRun] = React.useState(true);
  const [moveResult, setMoveResult] = React.useState<ApiCall | null>(null);
  const [moveLoading, setMoveLoading] = React.useState(false);
  const [moveError, setMoveError] = React.useState<string | null>(null);

  const [lookupId, setLookupId] = React.useState('');
  const [lookupPass, setLookupPass] = React.useState('');
  const [lookupResult, setLookupResult] = React.useState<ApiCall | null>(null);
  const [lookupLoading, setLookupLoading] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);

  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);
  const [pipelinesCall, setPipelinesCall] = React.useState<ApiCall | null>(null);
  const [statuses, setStatuses] = React.useState<Record<string, Status[]>>({});
  const [statusesCall, setStatusesCall] = React.useState<Record<string, ApiCall>>({});

  const loadPipelines = React.useCallback(async () => {
    const res = await callJson('/api/keycrm/pipelines', { method: 'GET' });
    setPipelinesCall(res);
    if (res.ok && Array.isArray((res.body as any)?.data)) {
      setPipelines((res.body as any).data);
    }
  }, []);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await callJson('/api/keycrm/pipelines', { method: 'GET' });
      if (!mounted) return;
      setPipelinesCall(res);
      if (res.ok && Array.isArray((res.body as any)?.data)) {
        setPipelines((res.body as any).data);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const loadStatuses = React.useCallback(
    async (pid: string) => {
      if (!pid || statuses[pid]) return;
      const res = await callJson(`/api/keycrm/statuses/${encodeURIComponent(pid)}`, { method: 'GET' });
      setStatusesCall((prev) => ({ ...prev, [pid]: res }));
      if (res.ok && Array.isArray((res.body as any)?.data)) {
        setStatuses((prev) => ({ ...prev, [pid]: (res.body as any).data }));
      }
    },
    [statuses]
  );

  React.useEffect(() => {
    if (pipelineId) {
      void loadStatuses(pipelineId);
    }
  }, [pipelineId, loadStatuses]);

  const handleManychatSubmit = async () => {
    setMcError(null);
    setMcLoading(true);
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(mcPayload);
      } catch (e: any) {
        setMcError('Невірний JSON: ' + (e?.message || String(e)));
        setMcLoading(false);
        return;
      }
      const res = await callJson('/api/mc/manychat', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setMcResult(res);
    } finally {
      setMcLoading(false);
    }
  };

  const handleMove = async () => {
    setMoveError(null);
    setMoveLoading(true);
    try {
      const trimmedCard = cardId.trim();
      if (!trimmedCard) {
        setMoveError('Вкажіть card_id.');
        return;
      }
      const payload = {
        card_id: trimmedCard,
        to_pipeline_id: pipelineId.trim() ? pipelineId.trim() : null,
        to_status_id: statusId.trim() ? statusId.trim() : null,
      };
      const url = dryRun ? '/api/keycrm/card/move?dry=1' : '/api/keycrm/card/move';
      const res = await callJson(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMoveResult(res);
      if (!res.ok) {
        setMoveError('KeyCRM повернув помилку. Перевірте відповідь нижче.');
      }
    } finally {
      setMoveLoading(false);
    }
  };

  const handleLookup = async () => {
    setLookupError(null);
    setLookupLoading(true);
    try {
      const trimmedId = lookupId.trim();
      if (!trimmedId) {
        setLookupError('Вкажіть ID картки.');
        return;
      }
      const params = new URLSearchParams();
      params.set('id', trimmedId);
      if (lookupPass.trim()) params.set('pass', lookupPass.trim());
      const res = await callJson(`/api/keycrm/card/get?${params.toString()}`, { method: 'GET' });
      setLookupResult(res);
      if (!res.ok) {
        setLookupError('Не вдалося отримати картку.');
      }
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-wide text-slate-500">Debug</p>
        <h1 className="text-3xl font-bold text-slate-900">ManyChat → KeyCRM</h1>
        <p className="text-slate-600 max-w-3xl">
          Сторінка для ручного тестування інтеграції: можна надіслати webhook ManyChat,
          знайти картку в KeyCRM та перемістити її у потрібну воронку/статус.
        </p>
      </header>

      <section className="grid gap-8 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold">1. ManyChat webhook</h2>
            <p className="text-sm text-slate-500">
              Вставте payload та натисніть «Надіслати». Сервіс покаже нормалізований текст і збіги по кампаніях.
            </p>
          </div>
          <div className="p-5 space-y-4">
            <textarea
              className="w-full h-48 rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={mcPayload}
              onChange={(e) => setMcPayload(e.target.value)}
            />
            {mcError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {mcError}
              </div>
            )}
            <button
              type="button"
              onClick={handleManychatSubmit}
              disabled={mcLoading}
              className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            >
              {mcLoading ? 'Надсилаю…' : 'Надіслати webhook'}
            </button>
            <ResponseCard title="Результат" result={mcResult} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold">2. Пошук картки</h2>
            <p className="text-sm text-slate-500">
              Швидко підтягніть деталі картки KeyCRM (виклик /api/keycrm/card/get). За потреби додайте пароль ADMIN_PASS.
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">ID картки</label>
                <input
                  className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Напр. 1234567890"
                  value={lookupId}
                  onChange={(e) => setLookupId(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">ADMIN_PASS (опційно)</label>
                <input
                  className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Якщо потрібен доступ"
                  value={lookupPass}
                  onChange={(e) => setLookupPass(e.target.value)}
                />
              </div>
            </div>
            {lookupError && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {lookupError}
              </div>
            )}
            <button
              type="button"
              onClick={handleLookup}
              disabled={lookupLoading}
              className="inline-flex items-center rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-60"
            >
              {lookupLoading ? 'Завантажую…' : 'Отримати картку'}
            </button>
            <ResponseCard title="Відповідь KeyCRM" result={lookupResult} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">3. Ручне переміщення картки</h2>
            <p className="text-sm text-slate-500">
              Використовує спільний endpoint /api/keycrm/card/move (той самий, що ManyChat автоматизація).
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Dry-run (тільки показати payload)
          </label>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="card_id">
              <input
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Обовʼязково"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
              />
            </Field>
            <Field label="pipeline_id">
              <select
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
              >
                <option value="">(без змін)</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="status_id">
              <select
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
                disabled={!pipelineId}
              >
                <option value="">(без змін)</option>
                {(pipelineId && statuses[pipelineId] ? statuses[pipelineId] : []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleMove}
              disabled={moveLoading}
              className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
            >
              {moveLoading ? 'Виконую…' : 'Запустити переміщення'}
            </button>
            <button
              type="button"
              onClick={loadPipelines}
              className="text-sm text-slate-600 underline-offset-4 hover:underline"
            >
              Оновити довідники
            </button>
            {pipelineId && statusesCall[pipelineId] && (
              <span className="text-xs text-slate-500">
                Статуси завантажено {statusesCall[pipelineId].ok ? 'успішно' : 'з помилкою'} · HTTP {statusesCall[pipelineId].status || '—'}
              </span>
            )}
          </div>

          {moveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {moveError}
            </div>
          )}

          <ResponseCard title="Відповідь переміщення" result={moveResult} />
          {pipelinesCall && (
            <div className="text-xs text-slate-500">
              Останній запит довідника: HTTP {pipelinesCall.status || '—'} · {pipelinesCall.ok ? 'ok' : 'error'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type FieldProps = { label: string; children: React.ReactNode };
function Field({ label, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

type ResponseCardProps = { title: string; result: ApiCall | null };
function ResponseCard({ title, result }: ResponseCardProps) {
  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        {title}: ще немає викликів.
      </div>
    );
  }

  const badgeClass = result.ok
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-red-100 text-red-700';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-x-3 text-sm font-medium text-slate-700">
          <span>{result.method}</span>
          <span className="text-slate-500">{result.url}</span>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
          {result.ok ? 'OK' : 'Error'} · {result.status || '—'} · {result.durationMs} мс
        </span>
      </div>
      {result.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {result.error}
        </div>
      )}
      {result.body != null && (
        <pre className="max-h-64 overflow-auto rounded-xl bg-black/90 p-3 text-xs text-emerald-100">
          {formatJson(result.body)}
        </pre>
      )}
      {!result.body && result.text && (
        <pre className="max-h-64 overflow-auto rounded-xl bg-black/80 p-3 text-xs text-amber-100">
          {result.text}
        </pre>
      )}
      <div className="text-xs text-slate-500">
        {new Date(result.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
