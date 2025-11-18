// web/app/admin/tools/sync-flow/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export const dynamic = 'force-dynamic';

// ----- Types -----

type StepStatus = 'idle' | 'pending' | 'success' | 'error';

type StepState<T> = {
  status: StepStatus;
  data: T | null;
  error: string | null;
  message?: string | null;
};

const idleState = <T,>(): StepState<T> => ({ status: 'idle', data: null, error: null, message: null });

type CampaignTarget = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

type Campaign = {
  id: string;
  name: string;
  base?: CampaignTarget;
  t1?: CampaignTarget;
  t2?: CampaignTarget;
  texp?: CampaignTarget;
  v1?: string;
  v2?: string;
  expDays?: number;
  counters?: { v1: number; v2: number; exp: number };
};

type PairResponse = {
  ok: boolean;
  matched?: boolean;
  route?: 'v1' | 'v2' | 'none';
  campaign?: { id?: string; name?: string; __index_id?: string };
  input?: { title?: string; handle?: string; text?: string };
  error?: string;
  message?: string;
  debug?: {
    candidates?: string[];
    candidateCount?: number;
    truncated?: boolean;
    ruleV1?: { value: string; op: string } | null;
    ruleV2?: { value: string; op: string } | null;
  };
};

type FindResponse = {
  ok: boolean;
  result?: {
    id?: string | number;
    title?: string;
    pipeline_id?: number;
    status_id?: number;
    contact_social?: string | null;
    contact_social_name?: string | null;
  } | null;
  used?: any;
  stats?: any;
  error?: string;
  hint?: string;
  message?: string;
};

type MoveResponse = {
  ok: boolean;
  moved?: boolean;
  via?: string;
  status?: number;
  response?: any;
  dry?: boolean;
  error?: string;
  responseText?: string;
  attempt?: string;
};

type Item = { id: string; title: string };

// ----- Helpers -----

function statusMeta(status: StepStatus) {
  switch (status) {
    case 'success':
      return { icon: '✅', label: 'Готово', tone: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' };
    case 'error':
      return { icon: '❌', label: 'Помилка', tone: 'text-red-600', bg: 'bg-red-50 border-red-200' };
    case 'pending':
      return { icon: '⏳', label: 'Виконується', tone: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
    default:
      return { icon: '⬜️', label: 'Очікує', tone: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' };
  }
}

async function fetchItems(url: string): Promise<Item[]> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    const arr = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.items)
      ? json.items
      : Array.isArray(json)
      ? json
      : [];
    return (arr as any[])
      .map((p) => ({
        id: String(p?.id ?? p?.value ?? p?.pipeline_id ?? p?.status_id ?? ''),
        title: String(
          p?.title ??
            p?.name ??
            p?.label ??
            p?.alias ??
            p?.statusName ??
            p?.pipelineName ??
            p?.id ??
            p?.value ??
            ''
        ),
      }))
      .filter((p) => p.id && p.title);
  } catch {
    return [];
  }
}

function jsonPreview(data: any) {
  if (data == null) return null;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function fmtTarget(target?: CampaignTarget) {
  if (!target) return '—';
  const parts = [target.pipelineName || target.pipeline, target.statusName || target.status].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function resolveItemTitle(id: string | null | undefined, options: Item[], fallback?: string) {
  if (!id) return '';
  const match = options.find((opt) => opt.id === id);
  if (match) return match.title;
  if (fallback) return fallback;
  return `#${id}`;
}

function present(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : '—';
  }
  if (typeof value === 'boolean') return value ? 'Так' : 'Ні';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type ErrorEntry = {
  step: number;
  title: string;
  message: string;
  hint?: string;
  context?: { label: string; value: string }[];
  raw?: any;
};

// ----- Components -----

function StepCard({
  step,
  title,
  status,
  children,
}: {
  step: string;
  title: string;
  status: StepStatus;
  children: React.ReactNode;
}) {
  const meta = statusMeta(status);
  return (
    <section className={`rounded-2xl border ${meta.bg} p-5 shadow-sm transition-all`}>
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{meta.icon}</span>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Крок {step}</p>
            <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          </div>
        </div>
        <span className={`text-sm font-semibold ${meta.tone}`}>{meta.label}</span>
      </header>
      <div className="space-y-3 text-sm text-slate-700">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  helper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  helper?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
      />
      {helper && <span className="text-xs text-slate-400">{helper}</span>}
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  helper,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Item[];
  helper?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
      >
        <option value="">— Обери значення —</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.title}
          </option>
        ))}
      </select>
      {helper && <span className="text-xs text-slate-400">{helper}</span>}
    </label>
  );
}

// ----- Page -----

export default function SyncFlowToolPage() {
  const [manychatValue, setManychatValue] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [cardIdOverride, setCardIdOverride] = useState('');
  const [dryRun, setDryRun] = useState(true);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [pipelines, setPipelines] = useState<Item[]>([]);

  const [targetStatuses, setTargetStatuses] = useState<Item[]>([]);

  const [step1, setStep1] = useState<StepState<PairResponse>>(idleState());
  const [step2, setStep2] = useState<StepState<{ campaign: Campaign; route: 'v1' | 'v2' }>>(idleState());
  const [step3, setStep3] = useState<StepState<FindResponse>>(idleState());
  const [step4, setStep4] = useState<StepState<MoveResponse>>(idleState());

  const [lastPair, setLastPair] = useState<PairResponse | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [basePipelineId, setBasePipelineId] = useState('');
  const [baseStatusId, setBaseStatusId] = useState('');
  const [baseStatuses, setBaseStatuses] = useState<Item[]>([]);
  const basePipelineRef = useRef('');
  const baseStatusRef = useRef('');
  const [activeRoute, setActiveRoute] = useState<'v1' | 'v2' | null>(null);
  const [lastFind, setLastFind] = useState<FindResponse | null>(null);

  const [targetPipelineId, setTargetPipelineId] = useState('');
  const [targetStatusId, setTargetStatusId] = useState('');

  const [running, setRunning] = useState(false);

  const targetPreset = activeRoute === 'v1' ? selectedCampaign?.t1 : activeRoute === 'v2' ? selectedCampaign?.t2 : undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const arr = (await res.json()) as Campaign[];
        if (!cancelled) {
          setCampaigns(Array.isArray(arr) ? arr : []);
          setCampaignsLoaded(true);
          setCampaignsError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setCampaignsLoaded(true);
          setCampaigns([]);
          setCampaignsError(err?.message || 'Не вдалося завантажити кампанії');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await fetchItems('/api/keycrm/pipelines');
      if (!cancelled) {
        setPipelines(items);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!basePipelineId) {
      setBaseStatuses([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const items = await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(basePipelineId)}`);
      if (!cancelled) setBaseStatuses(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [basePipelineId]);

  useEffect(() => {
    let cancelled = false;
    if (!targetPipelineId) {
      setTargetStatuses([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const items = await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(targetPipelineId)}`);
      if (!cancelled) setTargetStatuses(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetPipelineId]);

  useEffect(() => {
    if (!targetPipelineId && targetPreset?.pipeline) {
      setTargetPipelineId(targetPreset.pipeline);
    }
    if (!targetStatusId && targetPreset?.status) {
      setTargetStatusId(targetPreset.status);
    }
  }, [targetPreset, targetPipelineId, targetStatusId]);

  useEffect(() => {
    if (step3.status === 'success' && step3.data?.result?.id) {
      const id = String(step3.data.result.id);
      setCardIdOverride((prev) => prev || id);
    }
  }, [step3.status, step3.data?.result?.id]);

  function resetBelow(step: 1 | 2 | 3 | 4) {
    if (step <= 1) {
      setStep2(idleState());
      setSelectedCampaign(null);
      setActiveRoute(null);
      setLastPair(null);
      setBasePipelineId('');
      setBaseStatusId('');
      setBaseStatuses([]);
      basePipelineRef.current = '';
      baseStatusRef.current = '';
      setTargetPipelineId('');
      setTargetStatusId('');
    }
    if (step <= 2) {
      setStep3(idleState());
      setLastFind(null);
    }
    if (step <= 3) {
      setStep4(idleState());
    }
  }

  async function executeStep1(): Promise<PairResponse | null> {
    resetBelow(1);
    const text = manychatValue.trim();
    if (!text) {
      setStep1({ status: 'error', data: null, error: 'Введіть текст ManyChat для тесту.' });
      return null;
    }
    setStep1({ status: 'pending', data: null, error: null, message: null });
    try {
      const payload: Record<string, any> = {
        text,
        handle: instagramUsername.trim() || undefined,
        title: fullName.trim() ? `Чат з ${fullName.trim()}` : undefined,
        data: {
          user: { username: instagramUsername.trim() || undefined },
          message: { text },
        },
      };
      const res = await fetch('/api/keycrm/sync/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const json = (await res.json().catch(() => ({}))) as PairResponse;
      if (!res.ok || !json?.ok) {
        const msg = json?.error || json?.message || `${res.status} ${res.statusText}`;
        setStep1({ status: 'error', data: json ?? null, error: msg });
        return null;
      }
      setStep1({
        status: 'success',
        data: json,
        error: null,
        message: json.matched ? `Маршрут: ${json.route?.toUpperCase?.()}` : 'Маршрут не знайдено',
      });
      setLastPair(json);
      return json;
    } catch (err: any) {
      setStep1({ status: 'error', data: null, error: err?.message || String(err) });
      return null;
    }
  }

  function executeStep2(pair: PairResponse | null): { campaign: Campaign; route: 'v1' | 'v2' } | null {
    resetBelow(2);
    if (!pair) {
      setStep2({ status: 'error', data: null, error: 'Спершу виконайте ManyChat етап.' });
      return null;
    }
    if (!campaignsLoaded) {
      setStep2({ status: 'error', data: null, error: 'Кампанії ще завантажуються, спробуйте знову.' });
      return null;
    }
    if (campaignsError) {
      setStep2({ status: 'error', data: null, error: campaignsError });
      return null;
    }
    if (!pair.matched || !pair.campaign || !pair.route || pair.route === 'none') {
      setStep2({ status: 'error', data: pair as any, error: 'Не знайдено кампанію для цього тексту.' });
      return null;
    }
    const campaignId = pair.campaign.id || pair.campaign.__index_id || '';
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      setStep2({ status: 'error', data: pair as any, error: `Кампанію #${campaignId} не знайдено у KV.` });
      return null;
    }
    const target = pair.route === 'v1' ? campaign.t1 : campaign.t2;
    setSelectedCampaign(campaign);
    setActiveRoute(pair.route);
    const basePipeline = campaign.base?.pipeline ? String(campaign.base.pipeline) : '';
    const baseStatus = campaign.base?.status ? String(campaign.base.status) : '';
    setBasePipelineId(basePipeline);
    setBaseStatusId(baseStatus);
    basePipelineRef.current = basePipeline;
    baseStatusRef.current = baseStatus;
    if (target?.pipeline) setTargetPipelineId(target.pipeline);
    if (target?.status) setTargetStatusId(target.status);
    setStep2({
      status: 'success',
      data: { campaign, route: pair.route },
      error: null,
      message: `${campaign.name || `#${campaign.id}`} → ${pair.route.toUpperCase()}`,
    });
    return { campaign, route: pair.route };
  }

  async function executeStep3(_campaignData?: { campaign: Campaign; route: 'v1' | 'v2' }): Promise<FindResponse | null> {
    resetBelow(3);
    const username = instagramUsername.trim();
    const name = fullName.trim();
    if (!username && !name) {
      setStep3({ status: 'error', data: null, error: 'Введіть Instagram username або ПІБ.' });
      return null;
    }
    const search = new URLSearchParams();
    if (username) search.set('username', username);
    if (name) search.set('full_name', name);
    search.set('social_name', 'instagram');
    const basePipeline = basePipelineRef.current ? String(basePipelineRef.current).trim() : '';
    const baseStatus = baseStatusRef.current ? String(baseStatusRef.current).trim() : '';
    if (basePipeline && baseStatus) {
      search.set('scope', 'campaign');
      search.set('pipeline_id', basePipeline);
      search.set('status_id', baseStatus);
    } else {
      search.set('scope', 'global');
      if (basePipeline) search.set('pipeline_id', basePipeline);
      if (baseStatus) search.set('status_id', baseStatus);
    }
    search.set('strategy', username && name ? 'both' : username ? 'social' : 'title');
    search.set('max_pages', '5');
    search.set('page_size', '50');

    setStep3({ status: 'pending', data: null, error: null });
    try {
      const res = await fetch(`/api/keycrm/find?${search.toString()}`, { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as FindResponse;
      if (!res.ok || json?.ok === false) {
        const msg = json?.message || json?.error || `${res.status} ${res.statusText}`;
        setStep3({ status: 'error', data: json ?? null, error: msg });
        return null;
      }
      if (!json?.result?.id) {
        setStep3({ status: 'error', data: json ?? null, error: 'Картку не знайдено.' });
        setLastFind(json);
        return null;
      }
      setStep3({
        status: 'success',
        data: json,
        error: null,
        message: `Знайшли картку #${json.result.id}`,
      });
      setLastFind(json);
      setCardIdOverride((prev) => prev || String(json.result?.id ?? ''));
      return json;
    } catch (err: any) {
      setStep3({ status: 'error', data: null, error: err?.message || String(err) });
      return null;
    }
  }

  async function executeStep4(): Promise<MoveResponse | null> {
    setStep4({ status: 'pending', data: null, error: null });
    const cardId = cardIdOverride.trim() || (lastFind?.result?.id ? String(lastFind.result.id) : '');
    if (!cardId) {
      setStep4({ status: 'error', data: null, error: 'Вкажіть card_id вручну або виконайте пошук.' });
      return null;
    }
    const pipelineId = targetPipelineId || targetPreset?.pipeline || '';
    const statusId = targetStatusId || targetPreset?.status || '';
    if (!pipelineId || !statusId) {
      setStep4({ status: 'error', data: null, error: 'Оберіть цільову воронку та статус.' });
      return null;
    }
    try {
      const res = await fetch(`/api/keycrm/card/move${dryRun ? '?dry=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          card_id: cardId,
          to_pipeline_id: pipelineId,
          to_status_id: statusId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MoveResponse;
      if (!res.ok || json?.ok === false) {
        const msg = json?.error || `${res.status} ${res.statusText}`;
        setStep4({ status: 'error', data: json ?? null, error: msg });
        return null;
      }
      setStep4({
        status: 'success',
        data: json,
        error: null,
        message: dryRun ? 'Dry-run успішний (дані не змінені).' : 'Move виконано.',
      });
      return json;
    } catch (err: any) {
      setStep4({ status: 'error', data: null, error: err?.message || String(err) });
      return null;
    }
  }

  async function runSequence() {
    if (running) return;
    setRunning(true);
    try {
      const pair = await executeStep1();
      if (!pair) return;
      const step2Data = executeStep2(pair);
      if (!step2Data) return;
      const find = await executeStep3(step2Data);
      if (!find) return;
      await executeStep4();
    } finally {
      setRunning(false);
    }
  }

  const campaignBaseInfo = useMemo(() => {
    if (!selectedCampaign?.base) return null;
    const pipelineTitle = selectedCampaign.base.pipelineName || selectedCampaign.base.pipeline || '—';
    const statusTitle = selectedCampaign.base.statusName || selectedCampaign.base.status || '—';
    return `${pipelineTitle} → ${statusTitle}`;
  }, [selectedCampaign?.base]);

  const searchBaseInfo = useMemo(() => {
    if (!basePipelineId && !baseStatusId) return '';
    const pipelineTitle = basePipelineId
      ? resolveItemTitle(
          basePipelineId,
          pipelines,
          basePipelineId === (selectedCampaign?.base?.pipeline || '')
            ? selectedCampaign?.base?.pipelineName || basePipelineId
            : basePipelineId
        )
      : '';
    const statusTitle = baseStatusId
      ? resolveItemTitle(
          baseStatusId,
          baseStatuses,
          baseStatusId === (selectedCampaign?.base?.status || '')
            ? selectedCampaign?.base?.statusName || baseStatusId
            : baseStatusId
        )
      : '';
    return `${pipelineTitle || '—'} → ${statusTitle || '—'}`;
  }, [
    basePipelineId,
    baseStatusId,
    baseStatuses,
    pipelines,
    selectedCampaign?.base?.pipeline,
    selectedCampaign?.base?.pipelineName,
    selectedCampaign?.base?.status,
    selectedCampaign?.base?.statusName,
  ]);

  const baseOverrideActive = useMemo(() => {
    if (!selectedCampaign) return Boolean(basePipelineId || baseStatusId);
    const campaignPipeline = selectedCampaign.base?.pipeline || '';
    const campaignStatus = selectedCampaign.base?.status || '';
    return campaignPipeline !== (basePipelineId || '') || campaignStatus !== (baseStatusId || '');
  }, [basePipelineId, baseStatusId, selectedCampaign]);

  const baseStatusOptions = useMemo(() => {
    const items = [...baseStatuses];
    const currentId = baseStatusId || selectedCampaign?.base?.status || '';
    if (currentId && !items.some((opt) => opt.id === currentId)) {
      const fallbackTitle =
        currentId === (selectedCampaign?.base?.status || '')
          ? selectedCampaign?.base?.statusName || currentId
          : currentId;
      items.unshift({ id: currentId, title: fallbackTitle || `#${currentId}` });
    }
    return items;
  }, [baseStatuses, baseStatusId, selectedCampaign?.base?.status, selectedCampaign?.base?.statusName]);

  const searchScopeLabel = useMemo(() => {
    if (basePipelineId && baseStatusId) return 'Кампанія';
    if (basePipelineId || baseStatusId) return 'Частково (фільтри)';
    return 'Глобально';
  }, [basePipelineId, baseStatusId]);

  const errorEntries = useMemo<ErrorEntry[]>(() => {
    const entries: ErrorEntry[] = [];

    if (step1.status === 'error' && step1.error) {
      entries.push({
        step: 1,
        title: 'Отримання ManyChat події',
        message: step1.error,
        hint: 'Перевір вхідний текст та username з ManyChat і повтори відправку вебхуку.',
        context: [
          { label: 'Введений текст', value: present(manychatValue) },
          { label: 'Instagram username', value: present(instagramUsername) },
          { label: "Повне ім'я", value: present(fullName) },
        ],
        raw: step1.data,
      });
    }

    if (step2.status === 'error' && step2.error) {
      const pair = ((step2.data as unknown as PairResponse) || lastPair || null) as PairResponse | null;
      const campaignId = pair?.campaign?.id || pair?.campaign?.__index_id || '';
      const normalizedText = pair?.input?.text || pair?.input?.title || pair?.input?.handle || manychatValue;
      entries.push({
        step: 2,
        title: 'Пошук кампанії V1/V2',
        message: step2.error,
        hint:
          'Переконайся, що у KV є активна кампанія з правилом, яке відповідає нормалізованому тексту ManyChat та має заповнені маршрути V1/V2.',
        context: [
          { label: 'Нормалізований текст', value: present(normalizedText) },
          {
            label: 'Кандидати для правил',
            value:
              (pair?.debug?.candidateCount ?? pair?.debug?.candidates?.length ?? 0) > 0
                ? `${pair?.debug?.candidateCount ?? pair?.debug?.candidates?.length ?? 0}: ${pair?.debug?.candidates?.join(', ') || ''}${pair?.debug?.truncated ? ' …' : ''}`
                : '—',
          },
          {
            label: 'Правило V1',
            value: pair?.debug?.ruleV1
              ? `${pair.debug.ruleV1.value} (${pair.debug.ruleV1.op === 'equals' ? 'дорівнює' : 'містить'})`
              : '—',
          },
          {
            label: 'Правило V2',
            value: pair?.debug?.ruleV2
              ? `${pair.debug.ruleV2.value} (${pair.debug.ruleV2.op === 'equals' ? 'дорівнює' : 'містить'})`
              : '—',
          },
          { label: 'Маршрут з вебхуку', value: present(pair?.route ? pair.route.toUpperCase() : '—') },
          {
            label: 'Кампанія з вебхуку',
            value: campaignId ? `${pair?.campaign?.name || 'Без назви'} (#${campaignId})` : '—',
          },
          { label: 'Базова воронка кампанії', value: present(campaignBaseInfo) },
          {
            label: 'Поточна база для пошуку',
            value: present(searchBaseInfo || (basePipelineId || baseStatusId ? '—' : 'Глобально')),
          },
        ],
        raw: pair,
      });
    }

    if (step3.status === 'error' && step3.error) {
      const strategy = instagramUsername.trim() && fullName.trim() ? 'username + ПІБ' : instagramUsername.trim() ? 'username' : 'ПІБ';
      entries.push({
        step: 3,
        title: 'Пошук картки у KeyCRM',
        message: step3.error,
        hint:
          'Звір правильність username/ПІБ, а також налаштування базової воронки і статусу, через які виконується пошук.',
        context: [
          { label: 'Instagram username', value: present(instagramUsername) },
          { label: "Повне ім'я", value: present(fullName) },
          { label: 'Режим пошуку', value: strategy },
          { label: 'Область пошуку', value: searchScopeLabel },
          {
            label: 'База (воронка → статус)',
            value: present(searchBaseInfo || (basePipelineId || baseStatusId ? '—' : 'Глобально')),
          },
          { label: 'Базова воронка кампанії', value: present(campaignBaseInfo) },
          { label: 'Очікуваний card_id', value: present(cardIdOverride || lastFind?.result?.id) },
        ],
        raw: step3.data || lastFind,
      });
    }

    if (step4.status === 'error' && step4.error) {
      const effectivePipeline = targetPipelineId || targetPreset?.pipeline || '';
      const effectiveStatus = targetStatusId || targetPreset?.status || '';
      const pipelineTitle =
        pipelines.find((item) => item.id === effectivePipeline)?.title ||
        targetPreset?.pipelineName ||
        (effectivePipeline ? `#${effectivePipeline}` : '—');
      const statusTitle =
        targetStatuses.find((item) => item.id === effectiveStatus)?.title ||
        targetPreset?.statusName ||
        (effectiveStatus ? `#${effectiveStatus}` : '—');
      const cardId = cardIdOverride.trim() || (lastFind?.result?.id ? String(lastFind.result.id) : '');
      entries.push({
        step: 4,
        title: 'Move картки у KeyCRM',
        message: step4.error,
        hint: 'Переконайся, що card_id існує та має доступ до вибраної воронки і статусу. За потреби повтори пошук.',
        context: [
          { label: 'card_id для move', value: present(cardId) },
          { label: 'Цільова воронка', value: present(pipelineTitle) },
          { label: 'Цільовий статус', value: present(statusTitle) },
          { label: 'Режим виконання', value: dryRun ? 'Dry-run (без змін)' : 'Реальний move' },
        ],
        raw: step4.data,
      });
    }

    return entries;
  }, [
    basePipelineId,
    baseStatusId,
    baseStatuses,
    campaignBaseInfo,
    cardIdOverride,
    dryRun,
    fullName,
    instagramUsername,
    lastFind,
    lastPair,
    manychatValue,
    pipelines,
    searchBaseInfo,
    searchScopeLabel,
    step1.data,
    step1.error,
    step1.status,
    step2.data,
    step2.error,
    step2.status,
    step3.data,
    step3.error,
    step3.status,
    step4.data,
    step4.error,
    step4.status,
    targetPipelineId,
    targetPreset?.pipeline,
    targetPreset?.pipelineName,
    targetPreset?.status,
    targetPreset?.statusName,
    targetStatusId,
    targetStatuses,
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Sync flow: ManyChat → KeyCRM</h1>
          <p className="text-sm text-slate-500">
            Тестуємо всі етапи: від вхідного повідомлення до переміщення картки у потрібну воронку.
          </p>
        </div>
        <a href="/admin/tools" className="rounded-full border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          ← До інструментів
        </a>
      </div>

      <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-800">Вхідні дані для тесту</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="ManyChat — текст тригеру"
            value={manychatValue}
            onChange={setManychatValue}
            placeholder="Напр. V1 або інший текст, що йде у правила"
            helper="Саме це повідомлення перевіряється на V1/V2."
          />
          <Field
            label="Instagram username"
            value={instagramUsername}
            onChange={setInstagramUsername}
            placeholder="username без @"
            helper="Використовується для пошуку картки (social_id)."
          />
          <Field
            label="Повне ім'я (опційно)"
            value={fullName}
            onChange={setFullName}
            placeholder="Viktoria Kolachnyk"
            helper="Додається до ManyChat title: «Чат з ...» та до пошуку за full_name."
          />
          <Field
            label="KeyCRM card_id (опційно)"
            value={cardIdOverride}
            onChange={setCardIdOverride}
            placeholder="Якщо знаєш card_id — можна задати вручну"
            helper="Якщо залишити порожнім — підставиться значення з кроку пошуку."
          />
          <Select
            label="Базова воронка для пошуку"
            value={basePipelineId}
            onChange={(v) => {
              const next = v || '';
              setBasePipelineId(next);
              basePipelineRef.current = next;
              setBaseStatusId('');
              baseStatusRef.current = '';
            }}
            options={pipelines}
            helper="Використовується на кроці 3. Якщо залишити порожнім — пошук відбудеться глобально."
          />
          <Select
            label="Базовий статус для пошуку"
            value={baseStatusId}
            onChange={(v) => {
              const next = v || '';
              setBaseStatusId(next);
              baseStatusRef.current = next;
            }}
            options={baseStatusOptions}
            helper="Оберіть статус у межах базової воронки."
            disabled={!basePipelineId}
          />
        </div>
        {selectedCampaign?.base && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>
              Базові значення кампанії:&nbsp;
              <span className="font-medium text-slate-600">{campaignBaseInfo || '—'}</span>
            </span>
            <button
              type="button"
              className="rounded-lg border px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              onClick={() => {
                const pipeline = selectedCampaign.base?.pipeline ? String(selectedCampaign.base.pipeline) : '';
                const status = selectedCampaign.base?.status ? String(selectedCampaign.base.status) : '';
                setBasePipelineId(pipeline);
                basePipelineRef.current = pipeline;
                setBaseStatusId(status);
                baseStatusRef.current = status;
              }}
            >
              Повернути значення кампанії
            </button>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Поточна база пошуку: <span className="font-medium text-slate-600">{searchBaseInfo || 'Глобально'}</span>
          {baseOverrideActive && (
            <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Змінено вручну</span>
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!dryRun}
              onChange={(e) => setDryRun(!e.target.checked)}
            />
            <span>Виконати реальний move (зніми позначку для dry-run)</span>
          </label>
          <button
            type="button"
            onClick={runSequence}
            disabled={running}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
          >
            {running ? 'Виконується…' : 'Запустити всі етапи'}
          </button>
        </div>
      </section>

      {errorEntries.length > 0 && (
        <section className="mb-6 rounded-2xl border border-red-200 bg-red-50/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-red-700">Звіт по помилках</h2>
          <p className="mb-4 mt-1 text-sm text-red-700/80">
            Зібрали деталі останніх помилок по кроках, щоб швидше зрозуміти причину. Перевір вхідні дані та відповіді
            сервісів нижче.
          </p>
          <div className="space-y-4">
            {errorEntries.map((entry) => (
              <div key={`error-${entry.step}-${entry.message}`} className="rounded-xl border border-red-200 bg-white p-4">
                <header className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-red-600">
                    <span className="text-base font-semibold">Крок {entry.step}</span>
                    <span className="text-sm font-medium text-red-500/90">{entry.title}</span>
                  </div>
                  <span className="text-sm font-semibold text-red-500">{entry.message}</span>
                </header>
                {entry.hint && <p className="mb-3 text-xs text-slate-600">{entry.hint}</p>}
                {entry.context && entry.context.length > 0 && (
                  <dl className="mb-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    {entry.context.map(({ label, value }) => (
                      <div key={label} className="flex flex-col gap-0.5">
                        <dt className="font-medium text-slate-500">{label}</dt>
                        <dd className="rounded bg-slate-100 px-2 py-1 text-slate-700">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {entry.raw && (
                  <details className="rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
                    <summary className="cursor-pointer font-semibold text-slate-600">Сирі дані кроку</summary>
                    <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[11px] leading-4">
                      {jsonPreview(entry.raw) ?? '—'}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5">
        <StepCard step="1" title="Отримання ManyChat події" status={step1.status}>
          <p>
            Відправляємо тестовий payload у <code>/api/keycrm/sync/pair</code>, щоб побачити нормалізацію тексту, handle та
            маршрут (V1/V2).
          </p>
          {step1.message && <p className="text-sm font-medium text-slate-600">{step1.message}</p>}
          {step1.error && <p className="text-sm text-red-600">{step1.error}</p>}
          {step1.data?.debug && (
            <div className="mt-2 rounded-lg bg-white/60 p-3 text-xs text-slate-600">
              <p className="font-semibold">
                Знайдено {step1.data.debug.candidateCount ?? step1.data.debug.candidates?.length ?? 0} потенційних значень для
                матчінгу
              </p>
              {step1.data.debug.candidates && step1.data.debug.candidates.length > 0 ? (
                <p className="mt-1 break-words">
                  {step1.data.debug.candidates.join(', ')}
                  {step1.data.debug.truncated ? ' …' : ''}
                </p>
              ) : (
                <p className="mt-1 italic text-slate-500">З ManyChat payload не вдалося дістати жодного значення.</p>
              )}
              <div className="mt-2 grid gap-1">
                <div>
                  <span className="font-medium text-slate-500">Правило V1:</span>{' '}
                  {step1.data.debug.ruleV1
                    ? `${step1.data.debug.ruleV1.value} (${step1.data.debug.ruleV1.op === 'equals' ? 'дорівнює' : 'містить'})`
                    : '—'}
                </div>
                <div>
                  <span className="font-medium text-slate-500">Правило V2:</span>{' '}
                  {step1.data.debug.ruleV2
                    ? `${step1.data.debug.ruleV2.value} (${step1.data.debug.ruleV2.op === 'equals' ? 'дорівнює' : 'містить'})`
                    : '—'}
                </div>
              </div>
            </div>
          )}
          {step1.data && (
            <details className="rounded-lg bg-white/70 p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold">Відповідь webhook</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-4">
                {jsonPreview(step1.data) ?? '—'}
              </pre>
            </details>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={executeStep1}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            >
              Повторити крок 1
            </button>
          </div>
        </StepCard>

        <StepCard step="2" title="Пошук кампанії V1/V2" status={step2.status}>
          <p>
            Визначаємо кампанію та маршрут за ManyChat текстом. Крок очікує активну кампанію з правилами V1/V2 у KV.
          </p>
          {step2.message && <p className="text-sm font-medium text-slate-600">{step2.message}</p>}
          {campaignBaseInfo && (
            <p className="text-sm text-slate-500">
              Базова воронка кампанії: <span className="font-medium text-slate-700">{campaignBaseInfo}</span>
            </p>
          )}
          <p className="text-sm text-slate-500">
            Поточна база пошуку: <span className="font-medium text-slate-700">{searchBaseInfo || 'Глобально'}</span>
            {baseOverrideActive && (
              <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                Змінено вручну
              </span>
            )}
          </p>
          {targetPreset && (
            <p className="text-sm text-slate-500">
              Ціль для {activeRoute?.toUpperCase()}: <span className="font-medium text-slate-700">{fmtTarget(targetPreset)}</span>
            </p>
          )}
          {step2.error && <p className="text-sm text-red-600">{step2.error}</p>}
          {campaignsError && step2.status === 'error' && (
            <p className="text-xs text-red-500">{campaignsError}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => executeStep2(lastPair)}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            >
              Повторити крок 2
            </button>
          </div>
        </StepCard>

        <StepCard step="3" title="Пошук картки у KeyCRM" status={step3.status}>
          <p>
            Використовуємо <code>/api/keycrm/find</code> для пошуку картки за social_id або ПІБ у базовій воронці кампанії.
          </p>
          <p className="text-sm text-slate-500">
            Режим пошуку: <span className="font-medium text-slate-700">{searchScopeLabel}</span> · База:
            <span className="ml-1 font-medium text-slate-700">{searchBaseInfo || 'Глобально'}</span>
            {baseOverrideActive && (
              <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                Змінено вручну
              </span>
            )}
          </p>
          {campaignBaseInfo && (
            <p className="text-xs text-slate-500">
              Базова воронка кампанії: <span className="font-medium text-slate-700">{campaignBaseInfo}</span>
            </p>
          )}
          {step3.message && <p className="text-sm font-medium text-slate-600">{step3.message}</p>}
          {step3.error && <p className="text-sm text-red-600">{step3.error}</p>}
          {step3.data && (
            <details className="rounded-lg bg-white/70 p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold">JSON відповіді</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-4">
                {jsonPreview(step3.data) ?? '—'}
              </pre>
            </details>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => executeStep3(step2.data || undefined)}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            >
              Повторити крок 3
            </button>
          </div>
        </StepCard>

        <StepCard step="4" title="Move картки у KeyCRM" status={step4.status}>
          <p>
            Викликаємо <code>/api/keycrm/card/move</code>, щоб перевести знайдену картку в цільову воронку та статус.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              label="Цільова воронка"
              value={targetPipelineId || targetPreset?.pipeline || ''}
              onChange={(v) => setTargetPipelineId(v)}
              options={pipelines}
              helper="Підставляється з кампанії, але можна вибрати іншу."
            />
            <Select
              label="Цільовий статус"
              value={targetStatusId || targetPreset?.status || ''}
              onChange={(v) => setTargetStatusId(v)}
              options={targetStatuses}
              helper="Список оновлюється при зміні воронки."
            />
          </div>
          {step4.message && <p className="text-sm font-medium text-slate-600">{step4.message}</p>}
          {step4.error && <p className="text-sm text-red-600">{step4.error}</p>}
          {step4.data && (
            <details className="rounded-lg bg-white/70 p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold">Move response</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-4">
                {jsonPreview(step4.data) ?? '—'}
              </pre>
            </details>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={executeStep4}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            >
              Виконати move
            </button>
          </div>
        </StepCard>
      </div>
    </div>
  );
}
