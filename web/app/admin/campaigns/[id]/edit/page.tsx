// web/app/admin/campaigns/[id]/edit/page.tsx
'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Op = 'contains' | 'equals';
type Campaign = {
  id: string;
  created_at: string | number;
  updated_at?: string | number;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;

  v1_field: 'text' | 'any';
  v1_op: Op;
  v1_value: string;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;

  v2_enabled: boolean;
  v2_field: 'text' | 'any';
  v2_op: Op;
  v2_value: string;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;

  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;

  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
  pair_lookup_success_count?: number;
  pair_lookup_fail_count?: number;
  pair_move_success_count?: number;
  pair_move_fail_count?: number;
};
type Pipeline = { id: string | number; name: string };
type Status = { id: string | number; name: string; pipeline_id?: string | number };

// ---------- UI ----------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4 md:p-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-gray-600">{label}</span>
      {children}
    </label>
  );
}
function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`rounded-lg border px-3 py-2 text-sm outline-none ${props.className || ''}`} />;
}
function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`rounded-lg border px-3 py-2 text-sm outline-none ${props.className || ''}`} />;
}

// ---- helpers to normalize API shapes ----
function pickArr<T = any>(j: any, keys: string[]): T[] {
  for (const k of keys) {
    const v = j?.[k];
    if (Array.isArray(v)) return v as T[];
  }
  return Array.isArray(j) ? (j as T[]) : [];
}
function normPipelines(j: any): Pipeline[] {
  const arr = pickArr<Pipeline>(j, ['items', 'data', 'pipelines', 'result']);
  return arr.map((p: any) => ({ id: String(p.id ?? p.ID ?? p.value ?? ''), name: String(p.name ?? p.title ?? p.label ?? '') }))
            .filter(p => p.id && p.name);
}
function normStatuses(j: any): Status[] {
  const arr = pickArr<Status>(j, ['items', 'data', 'statuses', 'result']);
  return arr.map((s: any) => ({
    id: String(s.id ?? s.ID ?? s.value ?? ''),
    name: String(s.name ?? s.title ?? s.label ?? ''),
    pipeline_id: String(s.pipeline_id ?? s.pipelineId ?? s.pid ?? ''),
  })).filter(s => s.id && s.name);
}

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statusesByPid, setStatusesByPid] = useState<Record<string, Status[]>>({});
  const [dictErr, setDictErr] = useState<string | null>(null);

  const [c, setC] = useState<Campaign | null>(null);

  async function fetchPipelines() {
    setDictErr(null);
    try {
      const r = await fetch('/api/keycrm/pipelines', { credentials: 'include', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      const arr = normPipelines(j);
      if (!arr.length && j?.error) setDictErr(`pipelines: ${j.error}`);
      setPipelines(arr);
    } catch (e: any) {
      setDictErr(`pipelines: ${String(e?.message || e)}`);
      setPipelines([]);
    }
  }
  async function fetchStatuses(pid: string) {
    if (!pid || statusesByPid[pid]) return;
    try {
      const r = await fetch(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pid)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const j = await r.json().catch(() => ({}));
      const arr = normStatuses(j);
      setStatusesByPid((s) => ({ ...s, [pid]: arr }));
    } catch {
      setStatusesByPid((s) => ({ ...s, [pid]: [] }));
    }
  }
  const statuses = (pid?: string | null) => statusesByPid[String(pid || '')] || [];

  async function loadCampaign() {
    const r = await fetch('/api/campaigns', { credentials: 'include', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    const list: Campaign[] = Array.isArray(j.items) ? j.items : [];
    const found = list.find((x) => x.id === id) || null;
    if (!found) throw new Error('Campaign not found');
    setC(found);
    const pids = [found.base_pipeline_id, found.v1_to_pipeline_id || '', found.v2_to_pipeline_id || '', found.exp_to_pipeline_id || '']
      .filter(Boolean) as string[];
    await Promise.allSettled(pids.map((pid) => fetchStatuses(pid)));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchPipelines();
        await loadCampaign();
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = <K extends keyof Campaign>(key: K, value: Campaign[K]) =>
    setC((prev) => (prev ? { ...prev, [key]: value } : prev));

  function onPipelineChange(pKey: keyof Campaign, sKey: keyof Campaign, pid: string) {
    set(pKey, pid as any);
    set(sKey, '' as any);
    fetchStatuses(pid);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!c) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Campaign = {
        ...c,
        updated_at: new Date().toISOString(),
        v1_field: 'text',
        v2_field: 'text',
        v2_enabled: !!c.v2_enabled && !!(c.v2_value?.trim()),
      };
      const r = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || 'save failed');
      router.push('/admin/campaigns?updated=1');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="text-gray-600">Завантаження…</div>
      </div>
    );
  }
  if (error || !c) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-3 text-red-600">Помилка: {error || 'Не знайдено'}</div>
        <a href="/admin/campaigns" className="rounded-full border px-3 py-1.5 text-sm">← До списку</a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Редагувати кампанію</h1>
        <div className="flex gap-2">
          <a href="/admin/campaigns" className="rounded-full border px-3 py-1.5 text-sm">← До списку</a>
          <button
            type="button"
            onClick={() => {
              fetchPipelines().then(() => {
                if (c.base_pipeline_id) fetchStatuses(c.base_pipeline_id);
                if (c.v1_to_pipeline_id) fetchStatuses(c.v1_to_pipeline_id);
                if (c.v2_to_pipeline_id) fetchStatuses(c.v2_to_pipeline_id);
                if (c.exp_to_pipeline_id) fetchStatuses(c.exp_to_pipeline_id);
              });
            }}
            className="rounded-full border px-3 py-1.5 text-sm"
            title="Оновити довідники"
          >
            Оновити довідники
          </button>
        </div>
      </div>

      {dictErr && (
        <div className="mb-4 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {dictErr}
        </div>
      )}

      <form onSubmit={onSubmit} className="grid gap-6">
        {/* Загальні */}
        <Section title="Загальні">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Назва">
              <TextInput value={c.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Назва кампанії" required />
            </Field>
            <Field label="Увімкнено">
              <Select value={c.enabled ? '1' : '0'} onChange={(e) => set('enabled', e.target.value === '1')}>
                <option value="1">yes</option>
                <option value="0">no</option>
              </Select>
            </Field>
            <div />
          </div>
        </Section>

        {/* База */}
        <Section title="База">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Воронка (base_pipeline_id)">
              <Select
                value={c.base_pipeline_id || ''}
                onChange={(e) => onPipelineChange('base_pipeline_id', 'base_status_id', e.target.value)}
                required
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Статус (base_status_id)">
              <Select
                value={c.base_status_id || ''}
                onChange={(e) => set('base_status_id', e.target.value)}
                required
              >
                <option value="">—</option>
                {statuses(c.base_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </Section>

        {/* V1 */}
        <Section title="Варіант V1 (обов’язковий)">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Оператор">
              <Select value={c.v1_op} onChange={(e) => set('v1_op', e.target.value as Op)}>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </Select>
            </Field>
            <Field label="Значення (v1_value)">
              <TextInput value={c.v1_value || ''} onChange={(e) => set('v1_value', e.target.value)} placeholder="ключове слово" />
            </Field>
            <div />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Воронка призначення (v1)">
              <Select
                value={c.v1_to_pipeline_id || ''}
                onChange={(e) => onPipelineChange('v1_to_pipeline_id', 'v1_to_status_id', e.target.value)}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Статус призначення (v1)">
              <Select value={c.v1_to_status_id || ''} onChange={(e) => set('v1_to_status_id', e.target.value)}>
                <option value="">—</option>
                {statuses(c.v1_to_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </Section>

        {/* V2 */}
        <Section title="Варіант V2 (опційний)">
          <div className="mb-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!c.v2_enabled} onChange={(e) => set('v2_enabled', e.target.checked)} />
              Увімкнути V2
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Оператор">
              <Select value={c.v2_op} onChange={(e) => set('v2_op', e.target.value as Op)} disabled={!c.v2_enabled}>
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </Select>
            </Field>
            <Field label="Значення (v2_value)">
              <TextInput
                value={c.v2_value || ''}
                onChange={(e) => set('v2_value', e.target.value)}
                placeholder="ключове слово"
                disabled={!c.v2_enabled}
              />
            </Field>
            <div />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Воронка призначення (v2)">
              <Select
                value={c.v2_to_pipeline_id || ''}
                onChange={(e) => onPipelineChange('v2_to_pipeline_id', 'v2_to_status_id', e.target.value)}
                disabled={!c.v2_enabled}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Статус призначення (v2)">
              <Select
                value={c.v2_to_status_id || ''}
                onChange={(e) => set('v2_to_status_id', e.target.value)}
                disabled={!c.v2_enabled}
              >
                <option value="">—</option>
                {statuses(c.v2_to_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </Section>

        {/* EXP */}
        <Section title="EXP (експірація)">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Днів у базі (exp_days)">
              <TextInput
                type="number"
                inputMode="numeric"
                min={0}
                value={String(c.exp_days ?? 0)}
                onChange={(e) => set('exp_days', Number(e.target.value) || 0)}
              />
            </Field>
            <div />
            <div />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Воронка призначення (exp)">
              <Select
                value={c.exp_to_pipeline_id || ''}
                onChange={(e) => onPipelineChange('exp_to_pipeline_id', 'exp_to_status_id', e.target.value)}
              >
                <option value="">—</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Статус призначення (exp)">
              <Select value={c.exp_to_status_id || ''} onChange={(e) => set('exp_to_status_id', e.target.value)}>
                <option value="">—</option>
                {statuses(c.exp_to_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </Section>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Зберегти
          </button>
          <a href="/admin/campaigns" className="rounded-lg border px-4 py-2 text-sm">
            Скасувати
          </a>
        </div>
      </form>
    </div>
  );
}
