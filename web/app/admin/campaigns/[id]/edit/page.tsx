'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Item = { id: string; title: string };

type Draft = {
  id: string;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  v1_field?: 'text'|'flow'|'tag'|'any';
  v1_op?: 'contains'|'equals';
  v1_value?: string;
  v1_to_pipeline_id?: string|null;
  v1_to_status_id?: string|null;

  v2_enabled?: boolean;
  v2_field?: 'text'|'flow'|'tag'|'any';
  v2_op?: 'contains'|'equals';
  v2_value?: string;
  v2_to_pipeline_id?: string|null;
  v2_to_status_id?: string|null;

  exp_days: number;
  exp_to_pipeline_id?: string|null;
  exp_to_status_id?: string|null;

  enabled: boolean;

  // counters are read only on UI
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items', 'data', 'result', 'rows']) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}
function toItems(arr: any[]): Item[] {
  const out: Item[] = [];
  for (const p of arr) {
    const id = p?.id ?? p?.value ?? p?.key ?? p?.pipeline_id ?? p?.status_id ?? p?.uuid;
    const title = p?.title ?? p?.name ?? p?.label ?? p?.alias ?? (id != null ? `#${id}` : '');
    if (id != null) out.push({ id: String(id), title: String(title) });
  }
  const uniq = new Map<string, Item>();
  out.forEach(it => uniq.set(it.id, it));
  return [...uniq.values()];
}
async function fetchItems(url: string): Promise<Item[]> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return toItems(asArray(j?.items ?? j?.data ?? j?.result ?? j));
}

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // dropdown data
  const [pipelines, setPipelines] = useState<Item[]>([]);
  const [baseStatuses, setBaseStatuses] = useState<Item[]>([]);
  const [v1ToStatuses, setV1ToStatuses] = useState<Item[]>([]);
  const [v2ToStatuses, setV2ToStatuses] = useState<Item[]>([]);
  const [expToStatuses, setExpToStatuses] = useState<Item[]>([]);

  // draft
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // load initial
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [pl, resp] = await Promise.all([
          fetchItems('/api/keycrm/pipelines'),
          fetch(`/api/campaigns/${id}`, { cache: 'no-store' }),
        ]);
        setPipelines(pl);

        if (!resp.ok) throw new Error(`${resp.status}`);
        const j = await resp.json();
        const it = j?.item ?? j;

        const d: Draft = {
          id: String(it.id),
          name: it.name ?? '',
          base_pipeline_id: String(it.base_pipeline_id ?? ''),
          base_status_id: String(it.base_status_id ?? ''),
          v1_field: it.v1_field ?? it.v1_condition?.field ?? 'any',
          v1_op: it.v1_op ?? it.v1_condition?.op ?? 'contains',
          v1_value: it.v1_value ?? it.v1_condition?.value ?? '',
          v1_to_pipeline_id: it.v1_to_pipeline_id ?? null,
          v1_to_status_id: it.v1_to_status_id ?? null,

          v2_enabled: Boolean(it.v2_enabled ?? (it.v2_value || it.v2_to_pipeline_id)),
          v2_field: it.v2_field ?? it.v2_condition?.field ?? 'any',
          v2_op: it.v2_op ?? it.v2_condition?.op ?? 'contains',
          v2_value: it.v2_value ?? it.v2_condition?.value ?? '',
          v2_to_pipeline_id: it.v2_to_pipeline_id ?? null,
          v2_to_status_id: it.v2_to_status_id ?? null,

          exp_days: Number(it.exp_days ?? 7),
          exp_to_pipeline_id: it.exp_to_pipeline_id ?? null,
          exp_to_status_id: it.exp_to_status_id ?? null,

          enabled: Boolean(it.enabled ?? true),

          v1_count: it.v1_count ?? 0,
          v2_count: it.v2_count ?? 0,
          exp_count: it.exp_count ?? 0,
        };
        setDraft(d);
      } catch (e: any) {
        setError(e?.message || 'load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // dependent statuses
  useEffect(() => {
    (async () => {
      if (!draft?.base_pipeline_id) { setBaseStatuses([]); return; }
      setBaseStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(draft.base_pipeline_id)}`));
    })();
  }, [draft?.base_pipeline_id]);

  useEffect(() => {
    (async () => {
      if (!draft?.v1_to_pipeline_id) { setV1ToStatuses([]); return; }
      setV1ToStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(draft.v1_to_pipeline_id)}`));
    })();
  }, [draft?.v1_to_pipeline_id]);

  useEffect(() => {
    (async () => {
      if (!draft?.v2_to_pipeline_id) { setV2ToStatuses([]); return; }
      setV2ToStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(draft.v2_to_pipeline_id)}`));
    })();
  }, [draft?.v2_to_pipeline_id]);

  useEffect(() => {
    (async () => {
      if (!draft?.exp_to_pipeline_id) { setExpToStatuses([]); return; }
      setExpToStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(draft.exp_to_pipeline_id)}`));
    })();
  }, [draft?.exp_to_pipeline_id]);

  const v2Enabled = !!draft?.v2_enabled && (draft?.v2_value?.trim()?.length ?? 0) > 0;

  const canSubmit = useMemo(() => {
    if (!draft) return false;
    const baseOk = draft.name?.trim() && draft.base_pipeline_id && draft.base_status_id && Number.isFinite(draft.exp_days);
    const v1Ok = (draft.v1_value?.trim()?.length ?? 0) > 0 && draft.v1_to_pipeline_id && draft.v1_to_status_id;
    const v2Ok = !v2Enabled || (draft.v2_to_pipeline_id && draft.v2_to_status_id);
    return Boolean(baseOk && v1Ok && v2Ok);
  }, [draft, v2Enabled]);

  async function save() {
    if (!draft || !canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        base_pipeline_id: draft.base_pipeline_id,
        base_status_id: draft.base_status_id,

        v1_field: draft.v1_field ?? 'any',
        v1_op: draft.v1_op ?? 'contains',
        v1_value: draft.v1_value?.trim() ?? '',
        v1_to_pipeline_id: draft.v1_to_pipeline_id,
        v1_to_status_id: draft.v1_to_status_id,

        v2_enabled: !!draft.v2_enabled && (draft.v2_value?.trim()?.length ?? 0) > 0,
        v2_field: draft.v2_field ?? 'any',
        v2_op: draft.v2_op ?? 'contains',
        v2_value: draft.v2_value?.trim() ?? '',
        v2_to_pipeline_id: v2Enabled ? draft.v2_to_pipeline_id : null,
        v2_to_status_id: v2Enabled ? draft.v2_to_status_id : null,

        exp_days: Number(draft.exp_days),
        exp_to_pipeline_id: draft.exp_to_pipeline_id || null,
        exp_to_status_id: draft.exp_to_status_id || null,

        enabled: !!draft.enabled,
      };

      const r = await fetch(`/api/campaigns/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `${r.status}`);
      alert('Збережено');
      router.push('/admin/campaigns');
    } catch (e: any) {
      setError(e?.message || 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft) return;
    if (!confirm('Видалити кампанію безповоротно?')) return;
    const r = await fetch(`/api/campaigns/${draft.id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) { alert(j?.error || 'delete failed'); return; }
    router.push('/admin/campaigns');
  }

  if (loading) return <div className="p-6">Завантаження…</div>;
  if (error) return (
    <div className="p-6">
      <div className="mb-4 text-red-600">Помилка: {error}</div>
      <button className="rounded-xl px-4 py-2 border" onClick={() => location.reload()}>Спробувати ще</button>
    </div>
  );
  if (!draft) return <div className="p-6">Не знайдено</div>;

  const pipelinesSafe = pipelines ?? [];
  const baseStatusesSafe = baseStatuses ?? [];
  const v1ToStatusesSafe = v1ToStatuses ?? [];
  const v2ToStatusesSafe = v2ToStatuses ?? [];
  const expToStatusesSafe = expToStatuses ?? [];

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Редагування: {draft.name || draft.id}</h1>
        <div className="flex gap-3">
          <button onClick={() => router.push('/admin/campaigns')} className="rounded-xl px-4 py-2 border">До списку</button>
          <button onClick={remove} className="rounded-xl px-4 py-2 border text-red-600">Delete</button>
          <button onClick={save} disabled={!canSubmit || saving} className="rounded-xl px-4 py-2 border bg-blue-600 text-white disabled:opacity-50">{saving ? 'Збереження…' : 'Зберегти'}</button>
        </div>
      </div>

      {/* Загальне */}
      <div className="rounded-2xl border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <input
            className="w-full rounded-xl border px-3 py-2"
            placeholder="Назва"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}/>
            <span>Enabled</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-2">Базова воронка</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.base_pipeline_id}
                    onChange={(e) => setDraft({ ...draft, base_pipeline_id: e.target.value, base_status_id: '' })}>
              <option value="">— Оберіть воронку —</option>
              {pipelinesSafe.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-2">Базовий статус</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.base_status_id}
                    onChange={(e) => setDraft({ ...draft, base_status_id: e.target.value })}
                    disabled={!draft.base_pipeline_id}>
              <option value="">{draft.base_pipeline_id ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
              {baseStatusesSafe.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* V1 */}
      <div className="rounded-2xl border p-5 space-y-4">
        <div className="text-lg font-medium">Variant #1</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex gap-2">
            <select className="rounded-xl border px-3 py-2" value={draft.v1_field || 'any'} onChange={(e) => setDraft({ ...draft, v1_field: e.target.value as any })}>
              <option value="any">будь-що</option>
              <option value="text">text</option>
              <option value="flow">flow</option>
              <option value="tag">tag</option>
            </select>
            <select className="rounded-xl border px-3 py-2" value={draft.v1_op || 'contains'} onChange={(e) => setDraft({ ...draft, v1_op: e.target.value as any })}>
              <option value="contains">містить</option>
              <option value="equals">дорівнює</option>
            </select>
            <input className="flex-1 rounded-xl border px-3 py-2" placeholder="значення" value={draft.v1_value || ''} onChange={(e) => setDraft({ ...draft, v1_value: e.target.value })}/>
          </div>
          <div>
            <label className="block text-sm mb-2">Цільова воронка</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.v1_to_pipeline_id || ''}
                    onChange={(e) => setDraft({ ...draft, v1_to_pipeline_id: e.target.value, v1_to_status_id: '' })}>
              <option value="">— Оберіть воронку —</option>
              {pipelinesSafe.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-2">Цільовий статус</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.v1_to_status_id || ''}
                    onChange={(e) => setDraft({ ...draft, v1_to_status_id: e.target.value })}
                    disabled={!draft.v1_to_pipeline_id}>
              <option value="">{draft.v1_to_pipeline_id ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
              {v1ToStatusesSafe.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* V2 */}
      <div className="rounded-2xl border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-lg font-medium">Variant #2 (опційно)</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!draft.v2_enabled} onChange={(e) => setDraft({ ...draft, v2_enabled: e.target.checked })}/>
            <span>Увімкнути</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex gap-2">
            <select className="rounded-xl border px-3 py-2" value={draft.v2_field || 'any'} onChange={(e) => setDraft({ ...draft, v2_field: e.target.value as any })} disabled={!draft.v2_enabled}>
              <option value="any">будь-що</option>
              <option value="text">text</option>
              <option value="flow">flow</option>
              <option value="tag">tag</option>
            </select>
            <select className="rounded-xl border px-3 py-2" value={draft.v2_op || 'contains'} onChange={(e) => setDraft({ ...draft, v2_op: e.target.value as any })} disabled={!draft.v2_enabled}>
              <option value="contains">містить</option>
              <option value="equals">дорівнює</option>
            </select>
            <input className="flex-1 rounded-xl border px-3 py-2" placeholder="значення"
                   value={draft.v2_value || ''} onChange={(e) => setDraft({ ...draft, v2_value: e.target.value })}
                   disabled={!draft.v2_enabled}/>
          </div>
          <div>
            <label className="block text-sm mb-2">Цільова воронка</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.v2_to_pipeline_id || ''}
                    onChange={(e) => setDraft({ ...draft, v2_to_pipeline_id: e.target.value, v2_to_status_id: '' })}
                    disabled={!v2Enabled}>
              <option value="">— Оберіть воронку —</option>
              {pipelinesSafe.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-2">Цільовий статус</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.v2_to_status_id || ''}
                    onChange={(e) => setDraft({ ...draft, v2_to_status_id: e.target.value })}
                    disabled={!v2Enabled || !draft.v2_to_pipeline_id}>
              <option value="">{draft.v2_to_pipeline_id ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
              {v2ToStatusesSafe.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Expire */}
      <div className="rounded-2xl border p-5 space-y-4">
        <div className="text-lg font-medium">Variant #3 — Expiration</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-2">К-сть днів у базовій воронці</label>
            <input type="number" min={0} className="w-full rounded-xl border px-3 py-2"
                   value={draft.exp_days}
                   onChange={(e) => setDraft({ ...draft, exp_days: Number(e.target.value) })}/>
          </div>
          <div>
            <label className="block text-sm mb-2">Воронка</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.exp_to_pipeline_id || ''}
                    onChange={(e) => setDraft({ ...draft, exp_to_pipeline_id: e.target.value, exp_to_status_id: '' })}>
              <option value="">— Не переносити —</option>
              {pipelinesSafe.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-2">Статус</label>
            <select className="w-full rounded-xl border px-3 py-2"
                    value={draft.exp_to_status_id || ''}
                    onChange={(e) => setDraft({ ...draft, exp_to_status_id: e.target.value })}
                    disabled={!draft.exp_to_pipeline_id}>
              <option value="">{draft.exp_to_pipeline_id ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
              {expToStatusesSafe.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>

        <div className="text-sm text-gray-500">
          Лічильники: V1: {draft.v1_count ?? 0} • V2: {draft.v2_count ?? 0} • EXP: {draft.exp_count ?? 0}
        </div>
      </div>
    </div>
  );
}
