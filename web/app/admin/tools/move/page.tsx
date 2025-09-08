// web/app/admin/tools/move/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Item = { id: string; title: string };
function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items','data','result','rows','list']) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}
async function fetchItems(url: string): Promise<Item[]> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  const arr = asArray(j?.items ?? j?.data ?? j);
  const out: Item[] = [];
  for (const p of arr) {
    const id = p?.id ?? p?.value ?? p?.key ?? p?.pipeline_id ?? p?.status_id;
    const title = p?.title ?? p?.name ?? p?.label ?? (id != null ? `#${id}` : '');
    if (id != null) out.push({ id: String(id), title: String(title) });
  }
  // uniq by id
  const m = new Map(out.map((i) => [i.id, i]));
  return Array.from(m.values());
}

export default function AdminToolsMovePage() {
  const [pipelines, setPipelines] = useState<Item[]>([]);
  const [statuses, setStatuses] = useState<Item[]>([]);
  const [toPipelineId, setToPipelineId] = useState('');
  const [toStatusId, setToStatusId] = useState('');

  const [username, setUsername] = useState('');
  const [cardId, setCardId] = useState('');
  const [resolving, setResolving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [debug, setDebug] = useState<any>(null);
  const [msg, setMsg] = useState<string>('');

  useEffect(() => {
    (async () => {
      try { setPipelines(await fetchItems('/api/keycrm/pipelines')); }
      catch { setPipelines([]); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setStatuses([]); setToStatusId('');
      if (!toPipelineId) return;
      try {
        setStatuses(await fetchItems(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(toPipelineId)}`));
      } catch { setStatuses([]); }
    })();
  }, [toPipelineId]);

  async function resolveByUsername() {
    setResolving(true); setMsg(''); setDebug(null);
    try {
      const r = await fetch(`/api/keycrm/card/by-username?u=${encodeURIComponent(username.trim())}`, { cache: 'no-store' });
      const txt = await r.text();
      let j: any = {};
      try { j = JSON.parse(txt); } catch {}
      setDebug({ endpoint: 'by-username', status: r.status, body: j || txt });
      if (!r.ok || !(j?.ok)) throw new Error(j?.error || `HTTP ${r.status}`);
      setCardId(String(j.card_id || j.id || ''));
      setMsg('✅ Знайшли card_id і заповнили поле.');
    } catch (e: any) {
      setMsg(`⚠️ Не вдалося знайти card_id: ${e?.message || 'error'}. Можеш ввести card_id вручну.`);
    } finally { setResolving(false); }
  }

  const canMove = useMemo(
    () => !!cardId && !!toPipelineId && !!toStatusId,
    [cardId, toPipelineId, toStatusId],
  );

  async function doMove() {
    if (!canMove || moving) return;
    setMoving(true); setMsg(''); setDebug(null);
    try {
      const r = await fetch('/api/keycrm/card/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: cardId.trim(),
          to_pipeline_id: toPipelineId,
          to_status_id: toStatusId,
        }),
      });
      const txt = await r.text();
      let j: any = {};
      try { j = JSON.parse(txt); } catch {}
      setDebug({ endpoint: 'move', status: r.status, body: j || txt });
      if (!r.ok || !(j?.ok)) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsg('🎉 Карта переміщена успішно.');
    } catch (e: any) {
      setMsg(`❌ Помилка переміщення: ${e?.message || 'error'}`);
    } finally { setMoving(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin Tools · Move Card</h1>
        <Link href="/admin/campaigns" className="text-blue-600">← до кампаній</Link>
      </div>

      <div className="rounded-2xl border p-5 space-y-4">
        <div className="text-sm text-gray-600">
          Цей інструмент дозволяє вручну перевірити, що інтеграція з KeyCRM працює:
          знайти <code>card_id</code> за IG username і виконати <em>move</em> у вибраний pipeline/status.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">IG username</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="наприклад, insta_user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={resolveByUsername}
              disabled={resolving || !username.trim()}
              className="w-full rounded-xl px-4 py-2 border bg-blue-600 text-white disabled:opacity-50"
            >
              {resolving ? 'Пошук…' : 'Знайти card_id'}
            </button>
          </div>

          <div>
            <label className="block text-sm mb-1">card_id (можна вписати вручну)</label>
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="наприклад, 12345"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Куди → Воронка (pipeline)</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={toPipelineId}
              onChange={(e) => setToPipelineId(e.target.value)}
            >
              <option value="">— Оберіть воронку —</option>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Куди → Статус</label>
            <select
              className="w-full rounded-xl border px-3 py-2"
              value={toStatusId}
              onChange={(e) => setToStatusId(e.target.value)}
              disabled={!toPipelineId}
            >
              <option value="">{toPipelineId ? '— Оберіть статус —' : 'Спершу виберіть воронку'}</option>
              {statuses.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={doMove}
            disabled={!canMove || moving}
            className="rounded-xl px-5 py-2 border bg-blue-600 text-white disabled:opacity-50"
          >
            {moving ? 'Переміщуємо…' : 'Move'}
          </button>
          {msg && <div className="text-sm">{msg}</div>}
        </div>

        {debug && (
          <pre className="mt-3 text-xs bg-gray-50 rounded-xl p-3 overflow-x-auto">
{JSON.stringify(debug, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
