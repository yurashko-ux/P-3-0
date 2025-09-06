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
  const [v1ToStatuses, setV1ToStatuses] = useState<Item[]>([]);
  const [v2ToStatuses, setV2ToStatuses] = useState<Item[]>([]);
  const [expToStatuses, setExpToStatuses] = useState<Item[]>([]);

  // БЛОК 1: Назва + База
  const [name, setName] = useState('');
  const [basePipelineId, setBasePipelineId] = useState('');
  const [baseStatusId, setBaseStatusId] = useState('');

  // БЛОК 2: Варіант №1 (обов'язковий)
  const [v1Value, setV1Value] = useState(''); // варіант відповіді з ManiChat
  const [v1ToPipelineId, setV1ToPipelineId] = useState('');
  const [v1ToStatusId, setV1ToStatusId] = useState('');

  // БЛОК 3: Варіант №2 (опційний)
  const [v2Value, setV2Value] = useState('');
  const [v2ToPipelineId, setV2ToPipelineId] = useState('');
  const [v2ToStatusId, setV2ToStatusId] = useState('');

  // БЛОК 4: Expire
  const [expDays, setExpDays] = useState<number>(7);
  const [expToPipelineId, setExpToPipelineId] = useState('');
  const [expToStatusId, setExpToStatusId] = useState('');

  const [saving, setSaving] = useState(false);

  const v2Enabled = v2Value.trim().length > 0;

  const canSubmit = useMemo(() => {
    const baseOk =
      name.trim().length > 0 &&
      !!basePipelineId &&
      !!baseStatusId &&
      Number.isFinite(expDays) &&
      expDays >= 0;

    const v1Ok =
      v1Value.trim().length > 0 &&
      !!v1ToPipelineId &&
      !!v1ToStatusId;

    const v2Ok = !v2Enabled || (!!v2ToPipelineId && !!v2ToStatusId);

    const expOk = !expToPipelineId || !!expToStatusId; // якщо обрана воронка, статус теж обов'язковий

    return baseOk && v1Ok && v2Ok && expOk;
  }, [
    name, basePipelineId, baseStatusId,
    v1Value, v1ToPipelineId, v1ToStatusId,
    v2Enabled, v2ToPipelineId, v2ToStatusId,
    expDays, expToPipelineId, expToStatusId
  ]);

  // завантаження воронок
  useEffect(() => {
    (async () => {
      try { setPipelines(await fetchItems('/api/keycrm/pipelines')); }
      catch { setPipelines([]); }
    })();
  }, []);

  // статуси для базової воронки
  useEffect(() => {
    (async () => {
      setBaseStatuses([]); setBaseStatusId('');
      if (!basePipelineId) return;
      try { setBaseStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(basePipelineId)}`)); }
      catch { setBaseStatuses([]); }
    })();
  }, [basePipelineId]);

  // статуси для Варіанта 1 → "Куди"
  useEffect(() => {
    (async () => {
      setV1ToStatuses([]); setV1ToStatusId('');
      if (!v1ToPipelineId) return;
      try { setV1ToStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(v1ToPipelineId)}`)); }
      catch { setV1ToStatuses([]); }
    })();
  }, [v1ToPipelineId]);

  // статуси для Варіанта 2 → "Куди"
  useEffect(() => {
    (async () => {
      setV2ToStatuses([]); setV2ToStatusId('');
      if (!v2ToPipelineId) return;
      try { setV2ToStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(v2ToPipelineId)}`)); }
      catch { setV2ToStatuses([]); }
    })();
  }, [v2ToPipelineId]);

  // статуси для Expire → "Після експірації"
  useEffect(() => {
    (async () => {
      setExpToStatuses([]); setExpToStatusId('');
      if (!expToPipelineId) return;
      try { setExpToStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(expToPipelineId)}`)); }
      catch { setExpToStatuses([]); }
    })();
  }, [expToPipelineId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const payload: any = {
        name: name.trim(),
        base_pipeline_id: basePipelineId,
        base_status_id: baseStatusId,

        // Варіант №1 — обов'язковий: шукаємо text contains v1Value
        v1_field: 'text',
        v1_op: 'contains',
        v1_value: v1Value.trim(),
        v1_to_pipeline_id: v1ToPipelineId,
        v1_to_status_id: v1ToStatusId,

        // Варіант №2 — опційний: тільки якщо задано значення
        v2_enabled: v2Enabled,
        v2_field: 'text',
        v2_op: 'contains',
        v2_value: v2Value.trim(),
        v2_to_pipeline_id: v2Enabled ? v2ToPipelineId : null,
        v2_to_status_id: v2Enabled ? v2ToStatusId : null,

        // Expire
        exp_days: Number(expDays),
        exp_to_pipeline_id: expToPipelineId || null,
        exp_to_status_id: expToStatusId || null,

        enabled: true,
      };

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
  const v1ToStatusesSafe = Array.isArray(v1ToStatuses) ? v1ToStatuses : [];
  const v2ToStatusesSafe = Array.isArray(v2ToStatuses) ? v2ToStatuses : [];
  const expToStatusesSafe = Array.isArray(expToStatuses) ? expToStatuses : [];

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Нова кампанія</h1>

      {/* Блок 1: Назва / Базова воронка / Базовий статус */}
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="rounded-2xl border p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm mb-2">Назва кампанії</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="Напр. Розсилка → Відповіла"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm mb-2">Базова воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={basePipelineId}
                onChange={(e) => setBasePipelineId(e.target.value)}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelinesSafe.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">Базовий статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={baseStatusId}
                onChange={(e) => setBaseStatusId(e.target.value)}
                disabled={!basePipelineId || baseStatusesSafe.length === 0}
              >
                <option value="">{basePipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {baseStatusesSafe.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Блок 2: Варіант №1 */}
        <div className="rounded-2xl border p-5">
          <div className="text-lg font-medium mb-3">Варіант №1</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm mb-2">Значення</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="варіант відповіді з ManiChat"
                value={v1Value}
                onChange={(e) => setV1Value(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-2">Воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v1ToPipelineId}
                onChange={(e) => setV1ToPipelineId(e.target.value)}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelinesSafe.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-2">Статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v1ToStatusId}
                onChange={(e) => setV1ToStatusId(e.target.value)}
                disabled={!v1ToPipelineId || v1ToStatusesSafe.length === 0}
              >
                <option value="">{v1ToPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {v1ToStatusesSafe.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Блок 3: Варіант №2 (опційний) */}
        <div className="rounded-2xl border p-5">
          <div className="text-lg font-medium mb-3">Варіант №2</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm mb-2">Значення</label>
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="опційно — значення з ManiChat"
                value={v2Value}
                onChange={(e) => setV2Value(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-2">Воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v2ToPipelineId}
                onChange={(e) => setV2ToPipelineId(e.target.value)}
                disabled={!v2Enabled}
              >
                <option value="">{v2Enabled ? '— Оберіть воронку —' : 'Заповніть значення'}</option>
                {pipelinesSafe.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-2">Статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={v2ToStatusId}
                onChange={(e) => setV2ToStatusId(e.target.value)}
                disabled={!v2Enabled || !v2ToPipelineId || v2ToStatusesSafe.length === 0}
              >
                <option value="">{v2ToPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {v2ToStatusesSafe.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Блок 4: Expire */}
        <div className="rounded-2xl border p-5">
          <div className="text-lg font-medium mb-3">Expire</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm mb-2">Кількість днів до експірації</label>
              <input
                type="number"
                min={0}
                className="w-full rounded-xl border px-3 py-2"
                value={expDays}
                onChange={(e) => setExpDays(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-sm mb-2">Воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={expToPipelineId}
                onChange={(e) => setExpToPipelineId(e.target.value)}
              >
                <option value="">— Не переносити —</option>
                {pipelinesSafe.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-2">Статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={expToStatusId}
                onChange={(e) => setExpToStatusId(e.target.value)}
                disabled={!expToPipelineId || expToStatusesSafe.length === 0}
              >
                <option value="">{expToPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {expToStatusesSafe.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex items-center gap-3">
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
