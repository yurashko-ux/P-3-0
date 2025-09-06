// web/app/admin/campaigns/new/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { id: string; title: string };

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items', 'data', 'result', 'list', 'rows']) {
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
  for (const it of out) uniq.set(it.id, it);
  return Array.from(uniq.values());
}
async function fetchItems(url: string): Promise<Item[]> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json();
  return toItems(asArray(j?.items ?? j?.data ?? j?.result ?? j));
}

export default function NewCampaignPage() {
  const router = useRouter();

  // dropdown data
  const [pipelines, setPipelines] = useState<Item[]>([]);
  const [baseStatuses, setBaseStatuses] = useState<Item[]>([]);
  const [toStatuses, setToStatuses] = useState<Item[]>([]);
  const [expToStatuses, setExpToStatuses] = useState<Item[]>([]);
  const [v2ToStatuses, setV2ToStatuses] = useState<Item[]>([]);

  // form state
  const [name, setName] = useState('');
  const [basePipelineId, setBasePipelineId] = useState('');
  const [baseStatusId, setBaseStatusId] = useState('');

  const [toPipelineId, setToPipelineId] = useState('');
  const [toStatusId, setToStatusId] = useState('');

  const [expDays, setExpDays] = useState<number>(7);
  const [expToPipelineId, setExpToPipelineId] = useState('');
  const [expToStatusId, setExpToStatusId] = useState('');

  // Variant #2
  const [v2Enabled, setV2Enabled] = useState(false);
  const [v2Field, setV2Field] = useState<'text' | 'username'>('text');
  const [v2Op, setV2Op] = useState<'contains' | 'equals'>('contains');
  const [v2Value, setV2Value] = useState('');
  const [v2ToPipelineId, setV2ToPipelineId] = useState('');
  const [v2ToStatusId, setV2ToStatusId] = useState('');

  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => {
    const baseOk =
      name.trim().length > 0 &&
      !!basePipelineId &&
      !!baseStatusId &&
      !!toPipelineId &&
      !!toStatusId &&
      Number.isFinite(expDays) &&
      expDays >= 0;

    const v2Ok = !v2Enabled || (v2Value.trim().length > 0 && !!v2ToPipelineId && !!v2ToStatusId);
    return baseOk && v2Ok;
  }, [
    name, basePipelineId, baseStatusId, toPipelineId, toStatusId,
    expDays, v2Enabled, v2Value, v2ToPipelineId, v2ToStatusId,
  ]);

  // load pipelines once
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchItems('/api/keycrm/pipelines');
        setPipelines(data);
      } catch (e) {
        console.error('pipelines load failed', e);
        setPipelines([]);
      }
    })();
  }, []);

  // helper to load statuses for any pipeline id
  async function loadStatuses(pid: string): Promise<Item[]> {
    // приймає і pipeline_id, і pipeline (бек підтримує обидва)
    const u = `/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pid)}`;
    return await fetchItems(u);
  }

  // base statuses
  useEffect(() => {
    (async () => {
      setBaseStatuses([]); setBaseStatusId('');
      if (!basePipelineId) return;
      try { setBaseStatuses(await loadStatuses(basePipelineId)); }
      catch { setBaseStatuses([]); }
    })();
  }, [basePipelineId]);

  // target statuses
  useEffect(() => {
    (async () => {
      setToStatuses([]); setToStatusId('');
      if (!toPipelineId) return;
      try { setToStatuses(await loadStatuses(toPipelineId)); }
      catch { setToStatuses([]); }
    })();
  }, [toPipelineId]);

  // expiration to statuses
  useEffect(() => {
    (async () => {
      setExpToStatuses([]); setExpToStatusId('');
      if (!expToPipelineId) return;
      try { setExpToStatuses(await loadStatuses(expToPipelineId)); }
      catch { setExpToStatuses([]); }
    })();
  }, [expToPipelineId]);

  // v2 to statuses
  useEffect(() => {
    (async () => {
      setV2ToStatuses([]); setV2ToStatusId('');
      if (!v2ToPipelineId) return;
      try { setV2ToStatuses(await loadStatuses(v2ToPipelineId)); }
      catch { setV2ToStatuses([]); }
    })();
  }, [v2ToPipelineId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      // основний сценарій (Variant #1 — always → перенос у "Куди")
      const payload: any = {
        name: name.trim(),
        base_pipeline_id: basePipelineId,
        base_status_id: baseStatusId,

        v1_field: 'any',
        v1_op: 'always',
        v1_value: '',
        v1_to_pipeline_id: toPipelineId,
        v1_to_status_id: toStatusId,

        v2_enabled: v2Enabled,
        v2_field: v2Field,
        v2_op: v2Op,
        v2_value: v2Value.trim(),
        v2_to_pipeline_id: v2Enabled ? v2ToPipelineId : null,
        v2_to_status_id: v2Enabled ? v2ToStatusId : null,

        exp_days: Number(expDays),
        exp_to_pipeline_id: expToPipelineId || null,
        exp_to_status_id: expToStatusId || null,

        enabled: true,
      };

      // пробуємо POST у /api/campaigns, якщо ні — fallback у /api/campaigns/create
      const targets = ['/api/campaigns', '/api/campaigns/create'];
      let ok = false, lastErr = '';
      for (const u of targets) {
        const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j?.ok) { ok = true; break; }
        lastErr = j?.error ?? String(res.status);
      }
      if (!ok) throw new Error(lastErr || 'save failed');

      alert('Кампанію збережено');
      router.push('/admin/campaigns');
    } catch (e: any) {
      alert(`Помилка: ${e?.message ?? 'network'}`);
      setSaving(false);
    }
  }

  const pipelinesSafe = Array.isArray(pipelines) ? pipelines : [];
  const baseStatusesSafe = Array.isArray(baseStatuses) ? baseStatuses : [];
  const toStatusesSafe = Array.isArray(toStatuses) ? toStatuses : [];
  const expToStatusesSafe = Array.isArray(expToStatuses) ? expToStatuses : [];
  const v2ToStatusesSafe = Array.isArray(v2ToStatuses) ? v2ToStatuses : [];

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Нова кампанія</h1>

      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Зліва: База */}
        <div className="rounded-2xl border p-5 space-y-4">
          <div>
            <label className="block text-sm mb-2">Назва</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Напр. Розсилка → Відповіла"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2">База: воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={basePipelineId}
                onChange={(e) => setBasePipelineId(e.target.value)}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelinesSafe.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">База: статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={baseStatusId}
                onChange={(e) => setBaseStatusId(e.target.value)}
                disabled={!basePipelineId || baseStatusesSafe.length === 0}
              >
                <option value="">{basePipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {baseStatusesSafe.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Справа: Куди */}
        <div className="rounded-2xl border p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2">Куди: воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={toPipelineId}
                onChange={(e) => setToPipelineId(e.target.value)}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelinesSafe.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">Куди: статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={toStatusId}
                onChange={(e) => setToStatusId(e.target.value)}
                disabled={!toPipelineId || toStatusesSafe.length === 0}
              >
                <option value="">{toPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {toStatusesSafe.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-sm mb-2">Expiration (дні)</label>
              <input
                type="number"
                min={0}
                className="w-full rounded-xl border px-3 py-2"
                value={expDays}
                onChange={(e) => setExpDays(Number(e.target.value))}
              />
            </div>
            <div />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2">Після експірації: воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={expToPipelineId}
                onChange={(e) => setExpToPipelineId(e.target.value)}
              >
                <option value="">— Не переносити —</option>
                {pipelinesSafe.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">Після експірації: статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={expToStatusId}
                onChange={(e) => setExpToStatusId(e.target.value)}
                disabled={!expToPipelineId || expToStatusesSafe.length === 0}
              >
                <option value="">{expToPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {expToStatusesSafe.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Variant #2 */}
        <div className="md:col-span-2 rounded-2xl border p-5 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium">Варіант #2</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v2Enabled} onChange={(e) => setV2Enabled(e.target.checked)} />
              вкл.
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm mb-2">Поле</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v2Field}
                onChange={(e) => setV2Field(e.target.value as any)}
                disabled={!v2Enabled}
              >
                <option value="text">text</option>
                <option value="username">username</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-2">Умова</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v2Op}
                onChange={(e) => setV2Op(e.target.value as any)}
                disabled={!v2Enabled}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-2">Значення</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="наприклад, 'ціна' "
                value={v2Value}
                onChange={(e) => setV2Value(e.target.value)}
                disabled={!v2Enabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2">Куди (V2): воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v2ToPipelineId}
                onChange={(e) => setV2ToPipelineId(e.target.value)}
                disabled={!v2Enabled}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelinesSafe.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">Куди (V2): статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v2ToStatusId}
                onChange={(e) => setV2ToStatusId(e.target.value)}
                disabled={!v2Enabled || !v2ToPipelineId || v2ToStatusesSafe.length === 0}
              >
                <option value="">{v2ToPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {v2ToStatusesSafe.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Кнопки */}
        <div className="md:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="rounded-xl px-5 py-2 border bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
          <button type="button" onClick={() => router.back()} className="rounded-xl px-5 py-2 border">
            Скасувати
          </button>
        </div>
      </form>
    </div>
  );
}
