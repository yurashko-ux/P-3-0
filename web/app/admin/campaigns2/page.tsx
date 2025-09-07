// web/app/admin/campaigns2/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Campaign = {
  id: string;
  created_at: string | number;
  name: string;
  base_pipeline_id: string | null;
  base_status_id: string | null;
  v1_to_pipeline_id?: string | null;
  v1_to_status_id?: string | null;
  v2_to_pipeline_id?: string | null;
  v2_to_status_id?: string | null;
  exp_days?: number;
  exp_to_pipeline_id?: string | null;
  exp_to_status_id?: string | null;
  enabled?: boolean;
};

function asArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    if (Array.isArray((x as any).items)) return (x as any).items;
    if (Array.isArray((x as any).data?.items)) return (x as any).data.items;
    if (Array.isArray((x as any).campaigns)) return (x as any).campaigns;
  }
  return [];
}
const ts = (v: any) => (typeof v === 'number' ? v : Number.isFinite(Date.parse(String(v))) ? Date.parse(String(v)) : 0);
const essence = (c: Campaign) => {
  const base = `${c.base_pipeline_id ?? '—'}/${c.base_status_id ?? '—'}`;
  const v1 = `v1: —→ ${c.v1_to_pipeline_id ?? '—'}/${c.v1_to_status_id ?? '—'}`;
  const v2 = `; v2: —→ ${c.v2_to_pipeline_id ?? '—'}/${c.v2_to_status_id ?? '—'}`;
  const exp = typeof c.exp_days === 'number' ? `; exp (${c.exp_days} д.): —→ ${c.exp_to_pipeline_id ?? '—'}/${c.exp_to_status_id ?? '—'}` : '';
  return `${base} — ${v1}${v2}${exp}`;
};

export default function Campaigns2Page() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<{ status?: number; text?: string } | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setDebug(null);
      const r = await fetch(`/api/campaigns?_=${Date.now()}`, { cache: 'no-store' });
      const text = await r.text();
      setDebug({ status: r.status, text });
      if (!r.ok) throw new Error(`${r.status}`);
      let j: any = {};
      try { j = JSON.parse(text); } catch {}
      const arr = asArray(j) as Campaign[];
      arr.sort((a, b) => ts(b?.created_at) - ts(a?.created_at));
      setItems(arr);
      console.debug('Campaigns2 fetched:', { count: arr.length, sample: arr[0] });
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const body = useMemo(() => {
    if (loading) return <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Завантаження…</td></tr>;
    if (error)   return <tr><td colSpan={5} className="px-4 py-10 text-center text-red-600">Помилка: {error}</td></tr>;
    if (items.length === 0) return <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Поки що порожньо.</td></tr>;
    return items.map((c) => (
      <tr key={c.id} className="border-t">
        <td className="px-4 py-3">{new Date(ts(c.created_at)).toLocaleString()}</td>
        <td className="px-4 py-3 font-medium">{c.name}</td>
        <td className="px-4 py-3">{essence(c)}</td>
        <td className="px-4 py-3">{c.enabled ? 'yes' : 'no'}</td>
        <td className="px-4 py-3">
          <a href={`/admin/campaigns/${c.id}/edit`} className="underline">Edit</a>
        </td>
      </tr>
    ));
  }, [items, loading, error]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-semibold">Кампанії (debug)</h1>
        <div className="flex gap-3">
          <a href="/admin/campaigns" className="rounded-2xl border px-4 py-2">До основного списку</a>
          <button onClick={load} className="rounded-2xl border px-4 py-2">Оновити</button>
          <a href="/admin/campaigns/new" className="rounded-2xl bg-blue-600 text-white px-4 py-2">Нова кампанія</a>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">Дата</th>
              <th className="text-left px-4 py-3">Назва</th>
              <th className="text-left px-4 py-3">Сутність</th>
              <th className="text-left px-4 py-3">Статус</th>
              <th className="text-left px-4 py-3">Дії</th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      <details className="mt-4 rounded-2xl border p-4 bg-gray-50">
        <summary className="cursor-pointer">Показати debug відповіді /api/campaigns</summary>
        <div className="mt-3 text-sm">
          <div className="mb-2">Status: {debug?.status ?? '—'}</div>
          <pre className="whitespace-pre-wrap break-all">{debug?.text ?? '—'}</pre>
        </div>
      </details>
    </div>
  );
}
