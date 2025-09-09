// web/app/admin/campaigns/[id]/edit/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

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
};

type Pipeline = { id: string | number; name: string };
type Status = { id: string | number; name: string; pipeline_id?: string | number };

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-lg border px-3 py-2 text-sm outline-none ${props.className || ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-lg border px-3 py-2 text-sm outline-none ${props.className || ''}`}
    />
  );
}

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dictionaries
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status[]>>({}); // by pipeline_id

  // Campaign state
  const [c, setC] = useState<Campaign | null>(null);

  // ---- load dictionaries ----
  async function loadPipelines() {
    const r = await fetch('/api/keycrm/pipelines', { credentials: 'include', cache: 'no-store' });
    const j = await r.json();
    setPipelines(Array.isArray(j?.items) ? j.items : []);
  }
  async function loadStatusesForPipeline(pid: string) {
    if (!pid) return;
    if (statuses[pid]) return; // cached
    const r = await fetch(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pid)}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const j = await r.json();
    const arr: Status[] = Array.isArray(j?.items) ? j.items : [];
    setStatuses((s) => ({ ...s, [pid]: arr }));
  }

  // ---- load campaign ----
  async function loadCampaign() {
    const r = await fetch('/api/campaigns', { credentials: 'include', cache: 'no-store' });
    const j = await r.json();
    const items: Campaign[] = Array.isArray(j.items) ? j.items : [];
    const found = items.find((x) => x.id === id) || null;
    if (!found) throw new Error('Campaign not found');
    setC(found);
    // preload statuses for all referenced pipelines
    const pids = [
      found.base_pipeline_id,
      found.v1_to_pipeline_id || '',
      found.v2_to_pipeline_id || '',
      found.exp_to_pipeline_id || '',
    ].filter(Boolean) as string[];
    await Promise.allSettled(pids.map((pid) => loadStatusesForPipeline(pid)));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadPipelines();
        await loadCampaign();
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // helpers
  const statusOpts = (pid?: string | null) => statuses[String(pid || '')] || [];

  const onChange = <K extends keyof Campaign>(key: K, value: Campaign[K]) => {
    setC((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!c) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST', // upsert: create route приймає існуючий id
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...c,
          // нормалізуємо expected payload полів (на випадок null/undefined)
          v1_field: 'text',
          v2_field: 'text',
          v2_enabled: !!c.v2_enabled && !!c.v2_value,
        }),
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

  // When pipeline changes -> ensure statuses are loaded and reset chosen status if it doesn't belong
  function onPipelineChange(
    fieldPipeline: keyof Campaign,
    fieldStatus: keyof Campaign,
    pid: string
  ) {
    onChange(fieldPipeline, pid as any);
    loadStatusesForPipeline(pid);
    // reset status if current not from this pipeline
    onChange(fieldStatus, null as any);
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
        <a href="/admin/campaigns" className="rounded-full border px-3 py-1.5 text-sm">← До списку</a>
      </div>

      <form onSubmit={onSubmit} className="grid gap-6">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Назва">
            <TextInput
              value={c.name || ''}
              onChange={(e) => onChange('name', e.target.value)}
              required
              placeholder="Назва кампанії"
            />
          </Field>
          <Field label="Увімкнено">
            <Select
              value={c.enabled ? '1' : '0'}
              onChange={(e) => onChange('enabled', e.target.value === '1' ? true : false)}
            >
              <option value="1">yes</option>
              <option value="0">no</option>
            </Select>
          </Field>
        </div>

        {/* База */}
        <div className="rounded-2xl border p-4">
          <div className="mb-2 font-semibold">База</div>
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
                onChange={(e) => onChange('base_status_id', e.target.value)}
                required
              >
                <option value="">—</option>
                {statusOpts(c.base_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </div>

        {/* V1 */}
        <div className="rounded-2xl border p-4">
          <div className="mb-2 font-semibold">Варіант V1 (обов’язковий)</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Оператор">
              <Select
                value={c.v1_op}
                onChange={(e) => onChange('v1_op', e.target.value as Op)}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </Select>
            </Field>
            <Field label="Значення (v1_value)">
              <TextInput
                value={c.v1_value || ''}
                onChange={(e) => onChange('v1_value', e.target.value)}
                placeholder="ключове слово"
              />
            </Field>
            <div />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Воронка призначення">
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
            <Field label="Статус призначення">
              <Select
                value={c.v1_to_status_id || ''}
                onChange={(e) => onChange('v1_to_status_id', e.target.value)}
              >
                <option value="">—</option>
                {statusOpts(c.v1_to_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </div>

        {/* V2 */}
        <div className="rounded-2xl border p-4">
          <div className="mb-2 flex items-center gap-3">
            <div className="font-semibold">Варіант V2 (опційний)</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!c.v2_enabled}
                onChange={(e) => onChange('v2_enabled', e.target.checked)}
              />
              Увімкнути
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Оператор">
              <Select
                value={c.v2_op}
                onChange={(e) => onChange('v2_op', e.target.value as Op)}
                disabled={!c.v2_enabled}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </Select>
            </Field>
            <Field label="Значення (v2_value)">
              <TextInput
                value={c.v2_value || ''}
                onChange={(e) => onChange('v2_value', e.target.value)}
                placeholder="ключове слово"
                disabled={!c.v2_enabled}
              />
            </Field>
            <div />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Воронка призначення">
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
            <Field label="Статус призначення">
              <Select
                value={c.v2_to_status_id || ''}
                onChange={(e) => onChange('v2_to_status_id', e.target.value)}
                disabled={!c.v2_enabled}
              >
                <option value="">—</option>
                {statusOpts(c.v2_to_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </div>

        {/* EXP */}
        <div className="rounded-2xl border p-4">
          <div className="mb-2 font-semibold">EXP (експірація)</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Днів у базі (exp_days)">
              <TextInput
                type="number"
                inputMode="numeric"
                value={String(c.exp_days ?? 0)}
                onChange={(e) => onChange('exp_days', Number(e.target.value) || 0)}
                min={0}
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
              <Select
                value={c.exp_to_status_id || ''}
                onChange={(e) => onChange('exp_to_status_id', e.target.value)}
              >
                <option value="">—</option>
                {statusOpts(c.exp_to_pipeline_id).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Зберегти
          </button>
          <a
            href="/admin/campaigns"
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Скасувати
          </a>
        </div>
      </form>
    </div>
  );
}
