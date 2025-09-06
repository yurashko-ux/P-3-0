// web/app/campaigns/new/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { id: string; title: string };

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export default function NewCampaignPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [pipelines, setPipelines] = useState<Item[]>([]);
  const [baseStatuses, setBaseStatuses] = useState<Item[]>([]);
  const [toStatuses, setToStatuses] = useState<Item[]>([]);

  // form state
  const [name, setName] = useState('');
  const [basePipelineId, setBasePipelineId] = useState('');
  const [baseStatusId, setBaseStatusId] = useState('');
  const [toPipelineId, setToPipelineId] = useState('');
  const [toStatusId, setToStatusId] = useState('');
  const [expirationDays, setExpirationDays] = useState<number>(7);

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 &&
      basePipelineId &&
      baseStatusId &&
      toPipelineId &&
      toStatusId &&
      Number.isFinite(expirationDays) &&
      expirationDays >= 0
    );
  }, [name, basePipelineId, baseStatusId, toPipelineId, toStatusId, expirationDays]);

  // load pipelines
  useEffect(() => {
    (async () => {
      try {
        const data = await getJSON<{ ok: boolean; items: Item[] }>('/api/keycrm/pipelines');
        if (data.ok) setPipelines(data.items);
      } catch (e) {
        console.error('pipelines load failed', e);
      }
    })();
  }, []);

  // load base statuses when base pipeline changes
  useEffect(() => {
    (async () => {
      setBaseStatuses([]);
      setBaseStatusId('');
      if (!basePipelineId) return;
      try {
        const data = await getJSON<{ ok: boolean; items: Item[] }>(
          `/api/keycrm/statuses?pipeline_id=${encodeURIComponent(basePipelineId)}`
        );
        if (data.ok) setBaseStatuses(data.items);
      } catch (e) {
        console.error('base statuses failed', e);
      }
    })();
  }, [basePipelineId]);

  // load target statuses when target pipeline changes
  useEffect(() => {
    (async () => {
      setToStatuses([]);
      setToStatusId('');
      if (!toPipelineId) return;
      try {
        const data = await getJSON<{ ok: boolean; items: Item[] }>(
          `/api/keycrm/statuses?pipeline_id=${encodeURIComponent(toPipelineId)}`
        );
        if (data.ok) setToStatuses(data.items);
      } catch (e) {
        console.error('to statuses failed', e);
      }
    })();
  }, [toPipelineId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          base_pipeline_id: basePipelineId,
          base_status_id: baseStatusId,
          to_pipeline_id: toPipelineId,
          to_status_id: toStatusId,
          expiration_days: Number(expirationDays),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        alert(`Помилка: ${json?.error ?? res.status}`);
        setLoading(false);
        return;
      }
      // успіх → назад або на список
      alert('Збережено');
      router.back();
    } catch (e: any) {
      alert(`Помилка мережі: ${e?.message ?? 'unknown'}`);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-semibold mb-6">Нова кампанія</h1>

      <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Блок зліва */}
        <div className="rounded-2xl border p-5">
          <label className="block text-sm mb-2">Назва</label>
          <input
            className="w-full rounded-xl border px-3 py-2 mb-4"
            placeholder="Напр. Розсилка → Відповіла"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2">База: воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={basePipelineId}
                onChange={(e) => setBasePipelineId(e.target.value)}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">База: статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={baseStatusId}
                onChange={(e) => setBaseStatusId(e.target.value)}
                disabled={!basePipelineId || baseStatuses.length === 0}
              >
                <option value="">{basePipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {baseStatuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Блок справа */}
        <div className="rounded-2xl border p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2">Куди: воронка</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={toPipelineId}
                onChange={(e) => setToPipelineId(e.target.value)}
              >
                <option value="">— Оберіть воронку —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">Куди: статус</label>
              <select
                className="w-full rounded-xl border px-3 py-2"
                value={toStatusId}
                onChange={(e) => setToStatusId(e.target.value)}
                disabled={!toPipelineId || toStatuses.length === 0}
              >
                <option value="">{toPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
                {toStatuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm mb-2">Expiration (дні)</label>
            <input
              type="number"
              min={0}
              className="w-40 rounded-xl border px-3 py-2"
              value={expirationDays}
              onChange={(e) => setExpirationDays(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Кнопки */}
        <div className="md:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit || loading}
            className="rounded-xl px-5 py-2 border bg-blue-600 text-white disabled:opacity-50"
          >
            {loading ? 'Збереження…' : 'Зберегти'}
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
