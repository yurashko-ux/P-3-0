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

type OverviewResponse = {
  ok: boolean;
  env: {
    keycrm_base: boolean;
    keycrm_token: boolean;
    kv_url: boolean;
    kv_token: boolean;
    mc_token: boolean;
    admin_pass: boolean;
  };
  kv: {
    index: string;
    total: number;
    error: string | null;
  };
  campaigns: {
    id: string;
    name?: string | null;
    active?: boolean;
    base_pipeline_id?: number | null;
    base_status_id?: number | null;
    created_at?: number | null;
  }[];
  logs: {
    key: string;
    entries: {
      raw: string;
      ts?: number | null;
      matchesCount?: number | null;
      handle?: string | null;
      text?: string | null;
    }[];
    error: string | null;
  };
};

type CampaignLite = OverviewResponse['campaigns'][number];

type MatchedCampaign = {
  id?: string;
  name?: string;
  v1?: boolean;
  v2?: boolean;
};

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

function asObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return null;
}

function formatTimestamp(ts?: number | null): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

const sanitizeHandle = (value: string) => value.trim().replace(/^@+/, '');

export default function AdminDebugClient() {
  const [overview, setOverview] = React.useState<{
    loading: boolean;
    data: OverviewResponse | null;
    error: string | null;
    call: ApiCall | null;
  }>({ loading: true, data: null, error: null, call: null });

  const refreshOverview = React.useCallback(async () => {
    setOverview((prev) => ({ ...prev, loading: true }));
    const res = await callJson('/api/admin/debug/overview', { method: 'GET' });
    if (res.ok && asObject(res.body)) {
      setOverview({ loading: false, data: res.body as OverviewResponse, error: null, call: res });
    } else {
      setOverview({
        loading: false,
        data: null,
        error: res.error || `HTTP ${res.status || '—'}`,
        call: res,
      });
    }
  }, []);

  React.useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const campaignsById = React.useMemo(() => {
    const map = new Map<string, CampaignLite>();
    overview.data?.campaigns.forEach((c) => {
      if (c.id) map.set(String(c.id), c);
    });
    return map;
  }, [overview.data?.campaigns]);

  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);
  const [pipelinesCall, setPipelinesCall] = React.useState<ApiCall | null>(null);

  const refreshPipelines = React.useCallback(async () => {
    const res = await callJson('/api/keycrm/pipelines', { method: 'GET' });
    setPipelinesCall(res);
    if (res.ok && Array.isArray((res.body as any)?.data)) {
      const list = ((res.body as any).data as any[])
        .map((item) => {
          const id = item?.id ?? item?.value ?? null;
          if (!id) return null;
          return {
            id: String(id),
            name: item?.name ?? item?.title ?? String(id),
          } as Pipeline;
        })
        .filter(Boolean) as Pipeline[];
      setPipelines(list);
    }
  }, []);

  React.useEffect(() => {
    void refreshPipelines();
  }, [refreshPipelines]);

  const [statuses, setStatuses] = React.useState<Record<string, Status[]>>({});
  const [statusesCall, setStatusesCall] = React.useState<Record<string, ApiCall>>({});

  const loadStatuses = React.useCallback(
    async (pid: string, force = false) => {
      if (!pid) return null;
      if (!force && statuses[pid]) {
        return statusesCall[pid] ?? null;
      }
      const res = await callJson(`/api/keycrm/statuses/${encodeURIComponent(pid)}`, { method: 'GET' });
      setStatusesCall((prev) => ({ ...prev, [pid]: res }));
      if (res.ok && Array.isArray((res.body as any)?.data)) {
        const list = ((res.body as any).data as any[])
          .map((item) => {
            const id = item?.id ?? item?.value ?? null;
            if (!id) return null;
            return {
              id: String(id),
              name: item?.name ?? item?.title ?? String(id),
            } as Status;
          })
          .filter(Boolean) as Status[];
        setStatuses((prev) => ({ ...prev, [pid]: list }));
      }
      return res;
    },
    [statuses, statusesCall]
  );

  const [mcPayload, setMcPayload] = React.useState(DEFAULT_MC_PAYLOAD);
  const [mcCall, setMcCall] = React.useState<ApiCall | null>(null);
  const [mcError, setMcError] = React.useState<string | null>(null);
  const [mcLoading, setMcLoading] = React.useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = React.useState('');

  const [searchHandle, setSearchHandle] = React.useState('');
  const [searchPipelineId, setSearchPipelineId] = React.useState('');
  const [searchStatusId, setSearchStatusId] = React.useState('');
  const [searchCall, setSearchCall] = React.useState<ApiCall | null>(null);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchLoading, setSearchLoading] = React.useState(false);

  const [cardId, setCardId] = React.useState('');
  const [adminPass, setAdminPass] = React.useState('');
  const [inspectCall, setInspectCall] = React.useState<ApiCall | null>(null);
  const [inspectError, setInspectError] = React.useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = React.useState(false);

  const [movePipelineId, setMovePipelineId] = React.useState('');
  const [moveStatusId, setMoveStatusId] = React.useState('');
  const [dryRun, setDryRun] = React.useState(true);
  const [moveCall, setMoveCall] = React.useState<ApiCall | null>(null);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const [moveLoading, setMoveLoading] = React.useState(false);

  const applyCardContext = React.useCallback(
    (input: {
      id?: string | number | null;
      pipeline_id?: string | number | null;
      status_id?: string | number | null;
      handle?: string | null;
    }) => {
      if (input?.id != null && input.id !== '') {
        setCardId(String(input.id));
      }
      if (input?.handle) {
        setSearchHandle((prev) => (prev ? prev : String(input.handle)));
      }
      if (input?.pipeline_id != null && input.pipeline_id !== '') {
        const pipeline = String(input.pipeline_id);
        setSearchPipelineId(pipeline);
        setMovePipelineId(pipeline);
        void loadStatuses(pipeline);
      }
      if (input?.status_id != null && input.status_id !== '') {
        const status = String(input.status_id);
        setSearchStatusId(status);
        setMoveStatusId(status);
      }
    },
    [loadStatuses]
  );

  React.useEffect(() => {
    if (!selectedCampaignId) return;
    const campaign = campaignsById.get(selectedCampaignId);
    if (!campaign) return;
    if (campaign.base_pipeline_id) {
      const pipeline = String(campaign.base_pipeline_id);
      setSearchPipelineId((prev) => (prev ? prev : pipeline));
      setMovePipelineId((prev) => (prev ? prev : pipeline));
      void loadStatuses(pipeline);
    }
    if (campaign.base_status_id) {
      const status = String(campaign.base_status_id);
      setSearchStatusId((prev) => (prev ? prev : status));
      setMoveStatusId((prev) => (prev ? prev : status));
    }
  }, [campaignsById, selectedCampaignId, loadStatuses]);

  React.useEffect(() => {
    if (searchPipelineId) {
      void loadStatuses(searchPipelineId);
    }
  }, [searchPipelineId, loadStatuses]);

  React.useEffect(() => {
    if (movePipelineId) {
      void loadStatuses(movePipelineId);
    }
  }, [movePipelineId, loadStatuses]);

  const handleManychatSubmit = async () => {
    setMcError(null);
    setMcLoading(true);
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(mcPayload);
      } catch (e: any) {
        setMcError('Невірний JSON: ' + (e?.message || String(e)));
        return;
      }
      const res = await callJson('/api/mc/manychat', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setMcCall(res);
      if (!res.ok) {
        setMcError('Webhook повернув помилку. Перевірте відповідь нижче.');
      }
      const body = asObject(res.body);
      const normHandle = body?.normalized?.handle;
      if (normHandle) {
        setSearchHandle((prev) => (prev ? prev : normHandle));
      }
      const matches = Array.isArray(body?.matches) ? (body?.matches as MatchedCampaign[]) : [];
      if (matches.length) {
        const firstMatch = matches.find((m) => m.v1 || m.v2) || matches[0];
        if (firstMatch?.id) {
          setSelectedCampaignId(String(firstMatch.id));
        }
      }
    } finally {
      setMcLoading(false);
    }
  };

  const handleFindByHandle = async () => {
    setSearchError(null);
    const handleValue = sanitizeHandle(searchHandle);
    if (!handleValue) {
      setSearchError('Вкажіть username або social_id.');
      return;
    }
    if (!searchPipelineId) {
      setSearchError('Оберіть pipeline, де шукати картку.');
      return;
    }
    if (!searchStatusId) {
      setSearchError('Оберіть статус, де шукати картку.');
      return;
    }
    setSearchLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('handle', handleValue);
      params.set('pipeline_id', searchPipelineId);
      params.set('status_id', searchStatusId);
      const res = await callJson(`/api/keycrm/card/by-social?${params.toString()}`, { method: 'GET' });
      setSearchCall(res);
      if (!res.ok) {
        setSearchError('KeyCRM повернув помилку. Перевірте відповідь нижче.');
      }
      const body = asObject(res.body);
      const found = asObject(body?.found);
      if (found) {
        applyCardContext({
          id: found.id,
          pipeline_id: found.pipeline_id ?? body?.stats?.pipeline_id,
          status_id: found.status_id ?? body?.stats?.status_id,
          handle: found.social_id ?? handleValue,
        });
      }
    } finally {
      setSearchLoading(false);
    }
  };

  const handleInspectCard = async () => {
    setInspectError(null);
    const trimmed = cardId.trim();
    if (!trimmed) {
      setInspectError('Вкажіть card_id.');
      return;
    }
    setInspectLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('id', trimmed);
      if (adminPass.trim()) params.set('pass', adminPass.trim());
      const res = await callJson(`/api/keycrm/card/get?${params.toString()}`, { method: 'GET' });
      setInspectCall(res);
      if (!res.ok) {
        setInspectError('Не вдалося отримати картку. Перевірте відповідь нижче.');
      }
      const body = asObject(res.body);
      if (body) {
        applyCardContext({
          id: body.id,
          pipeline_id: body.pipeline_id,
          status_id: body.status_id,
          handle: body.contact_social_id,
        });
      }
    } finally {
      setInspectLoading(false);
    }
  };

  const handleMove = async () => {
    setMoveError(null);
    const trimmedCard = cardId.trim();
    if (!trimmedCard) {
      setMoveError('Вкажіть card_id для переміщення.');
      return;
    }
    setMoveLoading(true);
    try {
      const payload = {
        card_id: trimmedCard,
        to_pipeline_id: movePipelineId.trim() ? movePipelineId.trim() : null,
        to_status_id: moveStatusId.trim() ? moveStatusId.trim() : null,
      };
      const url = dryRun ? '/api/keycrm/card/move?dry=1' : '/api/keycrm/card/move';
      const res = await callJson(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMoveCall(res);
      if (!res.ok) {
        setMoveError('KeyCRM повернув помилку. Перевірте відповідь нижче.');
      }
    } finally {
      setMoveLoading(false);
    }
  };

  const normalizedPayload = React.useMemo(() => {
    return asObject(mcCall?.body)?.normalized ?? null;
  }, [mcCall]);

  const mcMatches = React.useMemo(() => {
    const matches = asObject(mcCall?.body)?.matches;
    if (!Array.isArray(matches)) return [] as MatchedCampaign[];
    return matches as MatchedCampaign[];
  }, [mcCall]);

  const cardSummary = React.useMemo(() => {
    const inspectBody = asObject(inspectCall?.body);
    const searchBody = asObject(searchCall?.body);
    const found = asObject(searchBody?.found);
    const summary = {
      id:
        cardId.trim() ||
        (inspectBody?.id ? String(inspectBody.id) : '') ||
        (found?.id ? String(found.id) : ''),
      pipeline_id:
        movePipelineId.trim() ||
        searchPipelineId.trim() ||
        (inspectBody?.pipeline_id ? String(inspectBody.pipeline_id) : '') ||
        (found?.pipeline_id ? String(found.pipeline_id) : ''),
      status_id:
        moveStatusId.trim() ||
        searchStatusId.trim() ||
        (inspectBody?.status_id ? String(inspectBody.status_id) : '') ||
        (found?.status_id ? String(found.status_id) : ''),
      handle:
        searchHandle.trim() ||
        (inspectBody?.contact_social_id ? String(inspectBody.contact_social_id) : '') ||
        (found?.social_id ? String(found.social_id) : ''),
      full_name: inspectBody?.contact_full_name ?? found?.full_name ?? null,
    };
    return summary;
  }, [cardId, movePipelineId, searchPipelineId, moveStatusId, searchStatusId, searchHandle, inspectCall, searchCall]);

  const pipelineName = React.useCallback(
    (id: string | null | undefined) => {
      if (!id) return null;
      const item = pipelines.find((p) => p.id === id);
      return item?.name ?? id;
    },
    [pipelines]
  );

  const statusName = React.useCallback(
    (pid: string | null | undefined, sid: string | null | undefined) => {
      if (!pid || !sid) return null;
      const list = statuses[pid];
      const item = list?.find((s) => s.id === sid);
      return item?.name ?? sid;
    },
    [statuses]
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-wide text-slate-500">Debug</p>
        <h1 className="text-3xl font-bold text-slate-900">ManyChat → KeyCRM</h1>
        <p className="text-slate-600 max-w-3xl">
          Перевірте всі етапи автоматизації: від webhook ManyChat до ручного переміщення картки у KeyCRM. Сторінка допомагає
          послідовно відтворити payload, знайдену картку та фінальний запит.
        </p>
      </header>

      <StepCard
        step="0"
        title="Огляд середовища"
        description="Переконайтесь, що токени KeyCRM, KV та ManyChat присутні, а KV зберігає кампанії та логи."
        action={
          <button
            type="button"
            onClick={refreshOverview}
            className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-slate-950"
          >
            Оновити
          </button>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Змінні середовища</h3>
              {overview.loading && <span className="text-xs text-slate-400">завантаження…</span>}
            </div>
            <dl className="grid gap-2">
              {[
                { key: 'KEYCRM_URL', ok: overview.data?.env.keycrm_base },
                { key: 'KEYCRM_TOKEN', ok: overview.data?.env.keycrm_token },
                { key: 'KV_URL', ok: overview.data?.env.kv_url },
                { key: 'KV_TOKEN', ok: overview.data?.env.kv_token },
                { key: 'MC_TOKEN', ok: overview.data?.env.mc_token },
                { key: 'ADMIN_PASS', ok: overview.data?.env.admin_pass },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <dt className="text-sm font-medium text-slate-600">{item.key}</dt>
                  <dd>
                    <StatusBadge ok={Boolean(item.ok)} />
                  </dd>
                </div>
              ))}
            </dl>
            {overview.error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{overview.error}</div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-700">Кампанії у KV</h3>
                <span className="text-xs text-slate-500">Всього: {overview.data?.kv.total ?? '—'}</span>
              </div>
              <div className="p-4 space-y-3">
                {overview.data?.kv.error && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {overview.data.kv.error}
                  </div>
                )}
                <div className="max-h-52 overflow-auto rounded-xl border border-slate-100">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">ID</th>
                        <th className="px-3 py-2 text-left font-semibold">Назва</th>
                        <th className="px-3 py-2 text-left font-semibold">База</th>
                        <th className="px-3 py-2 text-left font-semibold">Активна</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(overview.data?.campaigns || []).slice(0, 12).map((c) => (
                        <tr key={c.id} className={selectedCampaignId === String(c.id) ? 'bg-blue-50/70' : undefined}>
                          <td className="px-3 py-2 font-mono text-xs text-slate-600">{c.id}</td>
                          <td className="px-3 py-2 text-slate-700">{c.name || '—'}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">
                            <div>pipeline: {c.base_pipeline_id ?? '—'}</div>
                            <div>status: {c.base_status_id ?? '—'}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <StatusBadge ok={c.active !== false} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedCampaignId(String(c.id))}
                              className="text-xs font-semibold text-blue-600 underline-offset-4 hover:underline"
                            >
                              Обрати
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!overview.data?.campaigns?.length && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">
                            KV не містить жодної кампанії.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-700">Останні ManyChat webhook-и</h3>
                <span className="text-xs text-slate-500">{overview.data?.logs.key || '—'}</span>
              </div>
              <div className="p-4 space-y-3">
                {overview.data?.logs.error && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {overview.data.logs.error}
                  </div>
                )}
                <div className="space-y-2 max-h-52 overflow-auto">
                  {(overview.data?.logs.entries || []).map((log, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{formatTimestamp(log.ts)}</span>
                        {typeof log.matchesCount === 'number' && (
                          <span>збігів: {log.matchesCount}</span>
                        )}
                      </div>
                      <div className="text-sm text-slate-600">
                        {log.handle ? '@' + sanitizeHandle(log.handle) : '—'}
                        {log.text ? <span className="text-slate-400"> · {log.text}</span> : null}
                      </div>
                    </div>
                  ))}
                  {!overview.data?.logs.entries?.length && (
                    <div className="text-sm text-slate-500">Логів за сьогодні ще немає.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <ResponseCard title="Відповідь /api/admin/debug/overview" result={overview.call} />
      </StepCard>

      <StepCard
        step="1"
        title="Webhook ManyChat"
        description="Відправте тестовий payload, щоб побачити нормалізований текст і збіги з кампаніями."
        action={
          <button
            type="button"
            onClick={() => setMcPayload(DEFAULT_MC_PAYLOAD)}
            className="inline-flex items-center rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-200"
          >
            Скинути payload
          </button>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">ManyChat payload (JSON)</span>
              <textarea
                className="min-h-[220px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={mcPayload}
                onChange={(e) => setMcPayload(e.target.value)}
              />
            </label>
            {mcError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mcError}</div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleManychatSubmit}
                disabled={mcLoading}
                className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
              >
                {mcLoading ? 'Надсилаю…' : 'Надіслати webhook'}
              </button>
              <p className="text-xs text-slate-500">
                Використовується endpoint <code className="font-mono">/api/mc/manychat</code> із поточними KV-кампаніями.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {normalizedPayload ? (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                  Нормалізований payload
                </div>
                <div className="p-4 space-y-2 text-sm text-slate-600">
                  <div>
                    <span className="text-xs uppercase tracking-wide text-slate-400">Handle</span>
                    <div className="font-mono text-sm">{normalizedPayload.handle || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-wide text-slate-400">Title</span>
                    <div>{normalizedPayload.title || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-wide text-slate-400">Text</span>
                    <pre className="whitespace-pre-wrap rounded-xl bg-slate-900/90 p-3 text-xs text-emerald-100">
                      {normalizedPayload.text || '—'}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Після надсилання webhook тут зʼявиться нормалізований текст повідомлення.
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                Збіги з кампаніями
              </div>
              <div className="p-4 space-y-3">
                <div className="text-xs text-slate-500">
                  Виберіть кампанію, щоб підтягнути базові pipeline/status у наступних кроках.
                </div>
                <div className="max-h-64 overflow-auto rounded-xl border border-slate-100">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Кампанія</th>
                        <th className="px-3 py-2 text-left font-semibold">v1</th>
                        <th className="px-3 py-2 text-left font-semibold">v2</th>
                        <th className="px-3 py-2 text-left font-semibold">База</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mcMatches.map((match, idx) => {
                        const campaignId = match.id ? String(match.id) : `idx-${idx}`;
                        const campaign = match.id ? campaignsById.get(String(match.id)) : undefined;
                        return (
                          <tr key={campaignId} className={selectedCampaignId === String(match.id) ? 'bg-blue-50/70' : undefined}>
                            <td className="px-3 py-2">
                              <div className="text-sm text-slate-700">{match.name || campaign?.name || match.id || '—'}</div>
                              {match.id && (
                                <div className="font-mono text-xs text-slate-500">{match.id}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <StatusBadge ok={Boolean(match.v1)} label="v1" />
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <StatusBadge ok={Boolean(match.v2)} label="v2" />
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500">
                              <div>pipeline: {campaign?.base_pipeline_id ?? '—'}</div>
                              <div>status: {campaign?.base_status_id ?? '—'}</div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => match.id && setSelectedCampaignId(String(match.id))}
                                className="text-xs font-semibold text-blue-600 underline-offset-4 hover:underline"
                              >
                                Використати
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!mcMatches.length && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">
                            Поки що збігів немає.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <ResponseCard title="Відповідь ManyChat" result={mcCall} />
          </div>
        </div>
      </StepCard>

      <StepCard
        step="2"
        title="Перевірка картки у KeyCRM"
        description="Підтягніть картку за handle або card_id, щоб дізнатися її поточну воронку, статус та контакт."
      >
        <CardSummaryPanel summary={cardSummary} pipelineName={pipelineName} statusName={statusName} />

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">2.1 Пошук за handle</h3>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs uppercase tracking-wide text-slate-500">Instagram handle / social_id</span>
              <input
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Наприклад, @insta.user"
                value={searchHandle}
                onChange={(e) => setSearchHandle(e.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span className="text-xs uppercase tracking-wide text-slate-500">Поточна pipeline</span>
                <select
                  className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={searchPipelineId}
                  onChange={(e) => setSearchPipelineId(e.target.value)}
                >
                  <option value="">(оберіть pipeline)</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span className="text-xs uppercase tracking-wide text-slate-500">Поточний статус</span>
                <select
                  className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={searchStatusId}
                  onChange={(e) => setSearchStatusId(e.target.value)}
                  disabled={!searchPipelineId}
                >
                  <option value="">(оберіть статус)</option>
                  {(searchPipelineId && statuses[searchPipelineId] ? statuses[searchPipelineId] : []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {searchPipelineId && statusesCall[searchPipelineId] && (
              <span className="text-xs text-slate-500">
                Статуси: HTTP {statusesCall[searchPipelineId].status || '—'} ·{' '}
                {statusesCall[searchPipelineId].ok ? 'успішно' : 'помилка'}
              </span>
            )}
            {searchError && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{searchError}</div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleFindByHandle}
                disabled={searchLoading}
                className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
              >
                {searchLoading ? 'Шукаю…' : 'Знайти картку'}
              </button>
              <button
                type="button"
                onClick={() => searchPipelineId && loadStatuses(searchPipelineId, true)}
                className="text-xs font-semibold text-slate-600 underline-offset-4 hover:underline"
              >
                Оновити статуси
              </button>
            </div>
            <ResponseCard title="Відповідь пошуку" result={searchCall} />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">2.2 Інспекція card_id</h3>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs uppercase tracking-wide text-slate-500">card_id</span>
              <input
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Наприклад, 123456"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs uppercase tracking-wide text-slate-500">ADMIN_PASS (опційно)</span>
              <input
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="для захищених endpoint-ів"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
              />
            </label>
            {inspectError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{inspectError}</div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleInspectCard}
                disabled={inspectLoading}
                className="inline-flex items-center rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-900 disabled:opacity-60"
              >
                {inspectLoading ? 'Завантажую…' : 'Отримати картку'}
              </button>
            </div>
            <ResponseCard title="Відповідь card/get" result={inspectCall} />
          </div>
        </div>
      </StepCard>

      <StepCard
        step="3"
        title="Ручне переміщення картки"
        description="Відправте payload на /api/keycrm/card/move та порівняйте з автоматизацією ManyChat."
        action={
          <button
            type="button"
            onClick={refreshPipelines}
            className="inline-flex items-center rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-200"
          >
            Оновити pipelines
          </button>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs uppercase tracking-wide text-slate-500">card_id</span>
              <input
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                placeholder="ID картки для переміщення"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs uppercase tracking-wide text-slate-500">Нова pipeline</span>
              <select
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={movePipelineId}
                onChange={(e) => setMovePipelineId(e.target.value)}
              >
                <option value="">(без змін)</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-slate-600">
              <span className="text-xs uppercase tracking-wide text-slate-500">Новий статус</span>
              <select
                className="w-full rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={moveStatusId}
                onChange={(e) => setMoveStatusId(e.target.value)}
                disabled={!movePipelineId}
              >
                <option value="">(без змін)</option>
                {(movePipelineId && statuses[movePipelineId] ? statuses[movePipelineId] : []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {movePipelineId && statusesCall[movePipelineId] && (
            <span className="text-xs text-slate-500">
              Статуси нової pipeline: HTTP {statusesCall[movePipelineId].status || '—'} ·{' '}
              {statusesCall[movePipelineId].ok ? 'успішно' : 'помилка'}
            </span>
          )}

          {moveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{moveError}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Dry-run (тільки показати payload)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleMove}
                disabled={moveLoading}
                className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
              >
                {moveLoading ? 'Виконую…' : dryRun ? 'Зібрати payload' : 'Запустити переміщення'}
              </button>
            </div>
          </div>

          <ResponseCard title="Відповідь переміщення" result={moveCall} />
          {pipelinesCall && (
            <div className="text-xs text-slate-500">
              Останній запит /api/keycrm/pipelines: HTTP {pipelinesCall.status || '—'} ·{' '}
              {pipelinesCall.ok ? 'успішно' : 'помилка'} · {pipelinesCall.durationMs} мс
            </div>
          )}
        </div>
      </StepCard>
    </div>
  );
}

type StepCardProps = {
  step: string | number;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

function StepCard({ step, title, description, action, children }: StepCardProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white shadow-sm">
            {step}
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description ? <p className="text-sm text-slate-500">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

type StatusBadgeProps = { ok: boolean; label?: string };
function StatusBadge({ ok, label }: StatusBadgeProps) {
  const className = ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600';
  const text = label ?? (ok ? 'OK' : '—');
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {text}
      {label && (
        <span className="ml-1 text-[10px]">{ok ? '✓' : '×'}</span>
      )}
    </span>
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

  const badgeClass = result.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">
            {result.method} · {result.url}
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>
          {result.ok ? 'OK' : 'Error'} · {result.status || '—'} · {result.durationMs} мс
        </span>
      </div>
      <div className="space-y-3 p-4">
        {result.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{result.error}</div>
        )}
        {result.body != null ? (
          <pre className="max-h-72 overflow-auto rounded-xl bg-black/90 p-3 text-xs text-emerald-100">
            {formatJson(result.body)}
          </pre>
        ) : result.text ? (
          <pre className="max-h-72 overflow-auto rounded-xl bg-black/80 p-3 text-xs text-amber-100">{result.text}</pre>
        ) : null}
        <div className="text-xs text-slate-500">
          {new Date(result.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

type CardSummaryPanelProps = {
  summary: {
    id: string;
    pipeline_id: string;
    status_id: string;
    handle: string;
    full_name: string | null;
  };
  pipelineName: (id: string | null | undefined) => string | null;
  statusName: (pid: string | null | undefined, sid: string | null | undefined) => string | null;
};

function CardSummaryPanel({ summary, pipelineName, statusName }: CardSummaryPanelProps) {
  const hasInfo = summary.id || summary.pipeline_id || summary.status_id || summary.handle || summary.full_name;
  if (!hasInfo) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Виконайте пошук або інспекцію, щоб побачити коротке резюме картки.
      </div>
    );
  }

  const pipelineLabel = pipelineName(summary.pipeline_id) || summary.pipeline_id || '—';
  const statusLabel = statusName(summary.pipeline_id, summary.status_id) || summary.status_id || '—';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Поточний контекст картки</div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-400">card_id</div>
          <div className="font-mono text-sm text-slate-700">{summary.id || '—'}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-400">Поточна pipeline</div>
          <div className="text-sm text-slate-700">{pipelineLabel}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-400">Поточний статус</div>
          <div className="text-sm text-slate-700">{statusLabel}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-400">Контакт</div>
          <div className="text-sm text-slate-700">{summary.handle || '—'}</div>
          {summary.full_name && (
            <div className="text-xs text-slate-500">{summary.full_name}</div>
          )}
        </div>
      </div>
    </div>
  );
}
