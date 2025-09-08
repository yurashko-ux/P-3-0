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

type Pipeline = { id: string; title: string };
type Status = { id: string; title: string; pipeline_id?: string | number };

function toArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    if (Array.isArray(x.items)) return x.items;
    if (Array.isArray(x.data?.items)) return x.data.items;
    if (Array.isArray(x.result)) return x.result;
  }
  return [];
}
const ts = (v: any) => (typeof v === 'number' ? v : (Number.isFinite(Date.parse(String(v))) ? Date.parse(String(v)) : 0));
const nx = (v: any) => (v == null || v === '' ? '—' : String(v));

async function safeJson(url: string) {
  const r = await fetch(url, { cache: 'no-store' });
  const txt = await r.text();
  let j: any = {};
  try { j = JSON.parse(txt); } catch { j = {}; }
  return { ok: r.ok, status: r.status, json: j, text: txt };
}

export default function CampaignsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);

  // метадані для назв
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);

  // мапи id → назва
  const pMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pipelines) m.set(String(p.id), String(p.title));
    return m;
  }, [pipelines]);
  const sMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of statuses) m.set(String(s.id), String(s.title));
    return m;
  }, [statuses]);

  function pTitle(id?: string | null) { return pMap.get(String(id ?? '')) ?? nx(id); }
  function sTitle(id?: string | null) { return sMap.get(String(id ?? '')) ?? nx(id); }

  async function loadMeta() {
    // Пайплайни
    try {
      const { json } = await safeJson('/api/keycrm/pipelines');
      setPipelines(toArray(json) as Pipeline[]);
    } catch {
      setPipelines([]);
    }
    // Статуси: спочатку пробуємо без параметрів (може віддати все),
    // якщо порожньо — добираємо по кожній воронці.
    try {
      const base = await safeJson('/api/keycrm/statuses');
      let list = toArray(base.json) as Status[];
      if (!list.length) {
        const all: Status[] = [];
        await Promise.all(
          (pipelines || []).map(async (p) => {
            const { json } = await safeJson(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(p.id)}`);
            all.push(...(toArray(json) as Status[]));
          })
        );
        list = all;
      }
      setStatuses(list);
    } catch {
      setStatuses([]);
    }
  }

  async function loadCampaigns() {
    const { ok, json, status } = await safeJson(`/api/campaigns?_=${Date.now()}`);
    if (!ok) throw new Error(String(status));
    const arr: Campaign[] = Array.isArray(json) ? json : toArray(json);
    arr.sort((a, b) => ts(b?.created_at) - ts(a?.created_at));
    setItems(arr);
  }

  async function reload() {
    try {
      setLoading(true);
      setError(null);
      await Promise.all([loadCampaigns(), loadMeta()]);
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function onDelete(id: string) {
    if (!confirm('Видалити кампанію? Дію не можна відмінити.')) return;
    try {
      const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || `${r.status}`);
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      alert(`Не вдалось видалити: ${e?.message ?? 'unknown'}`);
    }
  }

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

    return items.map((c) => {
      const base = `${pTitle(c.base_pipeline_id)}/${sTitle(c.base_status_id)}`;
      const v1 = `V1 → ${pTitle(c.v1_to_pipeline_id)}/${sTitle(c.v1_to_status_id)}`;
      const v2 = `V2 → ${pTitle(c.v2_to_pipeline_id)}/${sTitle(c.v2_to_status_id)}`;
      const exp = typeof c.exp_days === 'number' && c.exp_days != null
        ? `EXP(${c.exp_days}д) → ${pTitle(c.exp_to_pipeline_id)}/${sTitle(c.exp_to_status_id)}`
        : 'EXP —';

      return (
        <tr key={c.id} className="border-t">
          <td className="px-4 py-3 whitespace-nowrap">{new Date(ts(c.created_at)).toLocaleString()}</td>
          <td className="px-4 py-3 font-medium">{c.name}</td>

          <td className="px-4 py-3">
            <div className="space-y-1">
              <div className="text-gray-700"><span className="text-gray-500">База:</span> {base}</div>
              <div className="text-gray-700">{v1}</div>
              <div className="text-gray-700">{v2}</div>
              <div className="text-gray-700">{exp}</div>
            </div>
          </td>

          <td className="px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border px-2 py-0.5 text-xs">V1: {c.v1_count ?? 0}</span>
              <span className="rounded-full border px-2 py-0.5 text-xs">V2: {c.v2_count ?? 0}</span>
              <span className="rounded-full border px-2 py-0.5 text-xs">EXP: {c.exp_count ?? 0}</span>
            </div>
          </td>

          <td className="px-4 py-3">{c.enabled ? 'yes' : 'no'}</td>

          <td className="px-4 py-3 space-x-3 whitespace-nowrap">
            <a className="underline" href={`/admin/campaigns/${c.id}/edit`}>Edit</a>
            <button
              onClick={() => onDelete(c.id)}
              className="underline text-red-600 hover:text-red-700"
            >
              Delete
            </button>
          </td>
        </tr>
      );
    });
  }, [items, loading, error, pMap, sMap]);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <div className="flex gap-3">
          <button onClick={reload} className="rounded-2xl border px-4 py-2">Оновити</button>
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
    </div>
  );
}
