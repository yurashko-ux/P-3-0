// web/app/admin/campaigns/page.tsx
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
  exp_days?: number | null;
  exp_to_pipeline_id?: string | null;
  exp_to_status_id?: string | null;
  enabled?: boolean;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function toArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    if (Array.isArray(x.items)) return x.items;
    if (Array.isArray(x.data?.items)) return x.data.items;
    if (Array.isArray(x.result)) return x.result;
  }
  return [];
}

const ts = (v: any) => {
  if (typeof v === 'number') return v;
  const n = Date.parse(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const essence = (c: Campaign) => {
  const base = `${c.base_pipeline_id ?? '—'}/${c.base_status_id ?? '—'}`;
  const v1 = `v1 → ${c.v1_to_pipeline_id ?? '—'}/${c.v1_to_status_id ?? '—'}`;
  const v2 = `; v2 → ${c.v2_to_pipeline_id ?? '—'}/${c.v2_to_status_id ?? '—'}`;
  const exp = typeof c.exp_days === 'number' && c.exp_days != null
    ? `; exp(${c.exp_days}д) → ${c.exp_to_pipeline_id ?? '—'}/${c.exp_to_status_id ?? '—'}`
    : '';
  return `${base} — ${v1}${v2}${exp}`;
};

export default function CampaignsPage() {
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

      // Підтримуємо і { ok, items }, і «просто масив»
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {}
      const arr: Campaign[] = Array.isArray(parsed) ? parsed : toArray(parsed);
      arr.sort((a, b) => ts(b?.created_at) - ts(a?.created_at));
      setItems(arr);
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (loading) return (
      <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">Завантаження…</td></tr>
    );
    if (error) return (
      <tr><td colSpan={6} className="px-4 py-10 text-center text-red-600">Помилка: {error}</td></tr>
    );
    if (items.length === 0) return (
      <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">Поки що порожньо.</td></tr>
    );
    return items.map((c) => (
      <tr key={c.id} className="border-t">
        <td className="px-4 py-3">{new Date(ts(c.created_at)).toLocaleString()}</td>
        <td className="px-4 py-3 font-medium">{c.name}</td>
        <td className="px-4 py-3">{essence(c)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          v1:{c.v1_count ?? 0} · v2:{c.v2_count ?? 0} · exp:{c.exp_count ?? 0}
        </td>
        <td className="px-4 py-3">{c.enabled ? 'yes' : 'no'}</td>
        <td className="px-4 py-3">
          <a className="underline" href={`/admin/campaigns/${c.id}/edit`}>Edit</a>
        </td>
      </tr>
    ));
  }, [items, loading, error]);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <div className="flex gap-3">
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
              <th className="text-left px-4 py-3">Лічильники</th>
              <th className="text-left px-4 py-3">Статус</th>
              <th className="text-left px-4 py-3">Дії</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>

      <details className="rounded-2xl border p-4 bg-gray-50">
        <summary className="cursor-pointer">Показати debug відповіді /api/campaigns</summary>
        <div className="mt-3 text-sm">
          <div className="mb-2">Status: {debug?.status ?? '—'}</div>
          <pre className="whitespace-pre-wrap break-all">{debug?.text ?? '—'}</pre>
        </div>
      </details>
    </div>
  );
}
