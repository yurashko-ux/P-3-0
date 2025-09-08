// web/app/admin/tools/move/page.tsx
'use client';

import { useEffect, useState } from 'react';

type Item = { id: string; title: string };

async function fetchItems(url: string): Promise<Item[]> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
  return (arr as any[]).map((p: any) => ({
    id: String(p?.id ?? p?.value ?? ''),
    title: String(p?.title ?? p?.name ?? p?.label ?? p?.alias ?? p?.id ?? ''),
  }));
}

export default function MoveToolPage() {
  const [cardId, setCardId] = useState('');
  const [pipelines, setPipelines] = useState<Item[]>([]);
  const [toPipelineId, setToPipelineId] = useState('');
  const [statuses, setStatuses] = useState<Item[]>([]);
  const [toStatusId, setToStatusId] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // load pipelines
  useEffect(() => {
    (async () => {
      setPipelines(await fetchItems('/api/keycrm/pipelines'));
    })();
  }, []);

  // load statuses for selected pipeline
  useEffect(() => {
    (async () => {
      setStatuses([]);
      setToStatusId('');
      if (!toPipelineId) return;
      setStatuses(
        await fetchItems(
          `/api/keycrm/statuses?pipeline_id=${encodeURIComponent(toPipelineId)}`
        )
      );
    })();
  }, [toPipelineId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!cardId || !toPipelineId || !toStatusId) {
      setMsg('Заповни Card ID, Воронку та Статус.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/keycrm/card/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: cardId.trim(),
          to_pipeline_id: toPipelineId,
          to_status_id: toStatusId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setMsg('✅ Перенесено успішно.');
      } else {
        setMsg(`❌ Помилка: ${j?.error || `${res.status} ${res.statusText}`}`);
      }
    } catch (err: any) {
      setMsg(`❌ Помилка запиту: ${err?.message || 'unknown'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Тест: Move Card у KeyCRM</h1>
      <p className="text-sm text-gray-600">
        Введи <b>Card ID</b> з KeyCRM і вибери цільову <b>воронку</b> та{' '}
        <b>статус</b>. Ендпойнт вимагає адмін-куку <code>admin_pass</code>.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border p-5">
        <div>
          <label className="block text-sm mb-1">Card ID</label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            placeholder="напр. 123456"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Цільова воронка</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={toPipelineId}
              onChange={(e) => setToPipelineId(e.target.value)}
            >
              <option value="">— Обери воронку —</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Цільовий статус</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={toStatusId}
              onChange={(e) => setToStatusId(e.target.value)}
              disabled={!toPipelineId || statuses.length === 0}
            >
              <option value="">
                {toPipelineId ? '— Обери статус —' : 'Спершу вибери воронку'}
              </option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl px-5 py-2 border bg-blue-600 text-white disabled:opacity-50"
          >
            {loading ? 'Виконую…' : 'Перенести'}
          </button>
        </div>

        {msg && <div className="text-sm">{msg}</div>}
      </form>
    </div>
  );
}
