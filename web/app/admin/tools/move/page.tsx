// web/app/admin/tools/move/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Item = { id: string; title: string };

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items', 'data', 'result', 'rows']) if (Array.isArray((x as any)[k])) return (x as any)[k];
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
  out.forEach(i => uniq.set(i.id, i));
  return [...uniq.values()];
}
async function fetchItems(url: string): Promise<Item[]> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return toItems(asArray(j?.items ?? j?.data ?? j?.result ?? j));
}

export default function MoveTesterPage() {
  const [pipelines, setPipelines] = useState<Item[]>([]);
  const [statuses, setStatuses] = useState<Item[]>([]);
  const [cardId, setCardId] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => setPipelines(await fetchItems('/api/keycrm/pipelines')))();
  }, []);
  useEffect(() => {
    (async () => {
      setStatuses([]);
      setStatusId('');
      if (!pipelineId) return;
      setStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pipelineId)}`));
    })();
  }, [pipelineId]);

  async function onMove() {
    setMsg(null);
    if (!cardId || !pipelineId || !statusId) {
      setMsg('Заповни всі поля');
      return;
    }
    setSending(true);
    try {
      const r = await fetch('/api/keycrm/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: cardId.trim(),
          to_pipeline_id: pipelineId,
          to_status_id: statusId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `${r.status}`);
      setMsg('✅ Переміщено успішно');
    } catch (e: any) {
      setMsg(`❌ Помилка: ${e?.message || 'move failed'}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">KeyCRM • Move tester</h1>
        <Link href="/admin/campaigns" className="rounded-xl px-4 py-2 border">До кампаній</Link>
      </div>

      <div className="rounded-2xl border p-5 space-y-4">
        <div>
          <label className="block text-sm mb-2">Card (Deal) ID</label>
          <input className="w-full rounded-xl border px-3 py-2" placeholder="введи ID картки" value={cardId} onChange={e => setCardId(e.target.value)}/>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-2">Воронка</label>
            <select className="w-full rounded-xl border px-3 py-2" value={pipelineId} onChange={e => setPipelineId(e.target.value)}>
              <option value="">— Оберіть воронку —</option>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-2">Статус</label>
            <select className="w-full rounded-xl border px-3 py-2" value={statusId} onChange={e => setStatusId(e.target.value)} disabled={!pipelineId}>
              <option value="">{pipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
              {statuses.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={onMove} disabled={sending} className="rounded-xl px-5 py-2 border bg-blue-600 text-white disabled:opacity-50">
            {sending ? 'Переміщуємо…' : 'Move'}
          </button>
          {msg && <div className="text-sm">{msg}</div>}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Після успішного Move перевір у KeyCRM картку з цим ID — має стояти саме ця воронка/статус.
      </p>
    </div>
  );
}
