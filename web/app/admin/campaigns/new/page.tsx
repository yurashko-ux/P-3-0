// web/app/admin/campaigns/new/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { id: string; title: string };

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    const cands = [x.items, x.data, x.result, x.list, x.rows];
    for (const c of cands) if (Array.isArray(c)) return c;
  }
  return [];
}

function toItems(arr: any[]): Item[] {
  const out: Item[] = [];
  for (const p of arr) {
    const id =
      p?.id ?? p?.value ?? p?.key ?? p?.pipeline_id ?? p?.status_id ?? p?.uuid;
    const title =
      p?.title ?? p?.name ?? p?.label ?? p?.alias ?? (id != null ? `#${id}` : '');
    if (id != null) out.push({ id: String(id), title: String(title) });
  }
  // унікалізація
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

  // form state
  const [name, setName] = useState('');
  const [basePipelineId, setBasePipelineId] = useState('');
  const [baseStatusId, setBaseStatusId] = useState('');
  const [toPipelineId, setToPipelineId] = useState('');
  const [toStatusId, setToStatusId] = useState('');
  const [expDays, setExpDays] = useState<number>(7);
  const [expToPipelineId, setExpToPipelineId] = useState('');
  const [expToStatusId, setExpToStatusId] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 &&
      !!basePipelineId &&
      !!baseStatusId &&
      !!toPipelineId &&
      !!toStatusId &&
      Number.isFinite(expDays) &&
      expDays >= 0
    );
  }, [name, basePipelineId, baseStatusId, toPipelineId, toStatusId, expDays]);

  // load pipelines once
  useEffect(() => {
    (async () => {
      try {
        setPipelines(await fetchItems('/api/keycrm/pipelines'));
      } catch (e) {
        console.error('pipelines load failed', e);
        setPipelines([]);
      }
    })();
  }, []);

  // load statuses when base pipeline changes
  useEffect(() => {
    (async () => {
      setBaseStatuses([]);
      setBaseStatusId('');
      if (!basePipelineId) return;
      try {
        setBaseStatuses(
          await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(basePipelineId)}`)
        );
      } catch (e) {
        console.error('base statuses failed', e);
        setBaseStatuses([]);
      }
    })();
  }, [basePipelineId]);

  // load statuses when "to" pipeline changes
  useEffect(() => {
    (async () => {
      setToStatuses([]);
      setToStatusId('');
      if (!toPipelineId) return;
      try {
        setToStatuses(
          await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(toPipelineId)}`)
        );
      } catch (e) {
        console.error('to statuses failed', e);
        setToStatuses([]);
      }
    })();
  }, [toPipelineId]);

  // load statuses when "expiration to" pipeline changes
  useEffect(() => {
    (async () => {
      setExpToStatuses([]);
      setExpToStatusId('');
      if (!expToPipelineId) return;
      try {
        setExpToStatuses(
          await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(expToPipelineId)}`)
        );
      } catch (e) {
        console.error('exp to statuses failed', e);
        setExpToStatuses([]);
      }
    })();
  }, [expToPipelineId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        base_pipeline_id: basePipelineId,
        base_status_id: baseStatusId,

        // робимо простий сценарій: завжди переносити у "Куди"
        v1_field: 'any',
        v1_op: 'always',
        v1_value: '',
        v1_to_pipeline_id: toPipelineId,
        v1_to_status_id: toStatusId,

        v2_enabled: false,
        v2_field: 'text',
        v2_op: 'contains',
        v2_value: '',
        v2_to_pipeline_id: null,
        v2_to_status_id: null,

        exp_days: Number(expDays),
        exp_to_pipeline_id: expToPipelineId || null,
        exp_to_status_id: expToStatusId || null,

        enabled: true,
      };

      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        alert(`Помилка: ${json?.error ?? res.status}`);
        setSaving(false);
        return;
      }

      alert('Кампанію збережено');
      router.push('/admin/campaigns');
    } catch (e: any) {
      alert(`Помилка мережі: ${e?.message ?? 'unknown'}`);
      setSaving(false);
    }
  }

  const pipelinesSafe = Array.isArray(pipelines) ? pipelines : [];
  const baseStatusesSafe = Array.isArray(baseStatuses) ? baseStatuses : [];
  const toStatusesSafe = Array.isArray(toStatuses) ? toStatuses : [];
  const expToStatusesSafe = Array.isArray(expToStatuses) ? expToStatuses : [];

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

        {/* Кнопки */}
        <div className="md:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="rounded-xl px-5 py-2 border bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl px-5 py-2 border"
          >
            Скасувати
          </button>
        </div>
      </form>
    </div>
  );
}
