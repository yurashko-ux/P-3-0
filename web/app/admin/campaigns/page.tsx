// web/app/admin/campaigns/page.tsx
'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ---- types ----
type Op = 'contains' | 'equals';
type Campaign = {
  id: string;
  created_at: string | number;
  updated_at?: string | number;

  name: string;
  enabled: boolean;

  base_pipeline_id: string;
  base_status_id: string;

  v1_field: 'text' | 'any';
  v1_op: Op;
  v1_value: string;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;

  v2_enabled: boolean;
  v2_field: 'text' | 'any';
  v2_op: Op;
  v2_value: string;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;

  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;

  v1_count: number;
  v2_count: number;
  exp_count: number;
};
type Pipeline = { id: string | number; name: string };
type Status = { id: string | number; name: string; pipeline_id?: string | number };

// ---- helpers ----
const toArray = <T,>(j: any): T[] => (Array.isArray(j) ? j : []);
const pickArr = <T,>(j: any, keys: string[]): T[] => {
  for (const k of keys) {
    const v = j?.[k];
    if (Array.isArray(v)) return v as T[];
  }
  return toArray<T>(j);
};
const normPipelines = (j: any): Pipeline[] =>
  pickArr<Pipeline>(j, ['items', 'data', 'pipelines', 'result']).map((p: any) => ({
    id: String(p.id ?? p.ID ?? p.value ?? ''),
    name: String(p.name ?? p.title ?? p.label ?? ''),
  })).filter(p => p.id && p.name);

const normStatuses = (j: any): Status[] =>
  pickArr<Status>(j, ['items', 'data', 'statuses', 'result']).map((s: any) => ({
    id: String(s.id ?? s.ID ?? s.value ?? ''),
    name: String(s.name ?? s.title ?? s.label ?? ''),
    pipeline_id: String(s.pipeline_id ?? s.pipelineId ?? s.pid ?? ''),
  })).filter(s => s.id && s.name);

const fmtDate = (v: string | number) => {
  try {
    const d = typeof v === 'number' ? new Date(v) : new Date(v);
    return d.toLocaleString('uk-UA', { hour12: false });
  } catch {
    return String(v);
  }
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border px-2 py-1 text-xs">{children}</span>
  );
}

export default function CampaignsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Campaign[]>([]);
  const [pipelines, setPipelines] = useState<Record<string, string>>({});
  const [statusesByPid, setStatusesByPid] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  // ---- load list ----
  async function loadCampaigns() {
    const r = await fetch('/api/campaigns', { credentials: 'include', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    setItems(Array.isArray(j.items) ? j.items : []);
  }

  // ---- load pipelines and statuses for all referenced pipeline_ids ----
  async function loadDictionaries(camps: Campaign[]) {
    // Pipelines
    const pr = await fetch('/api/keycrm/pipelines', { credentials: 'include', cache: 'no-store' });
    const pj = await pr.json().catch(() => ({}));
    const plist = normPipelines(pj);
    const pMap: Record<string, string> = {};
    plist.forEach(p => { pMap[String(p.id)] = p.name; });
    setPipelines(pMap);

    // Collect unique pipeline ids we need statuses for
    const pids = new Set<string>();
    for (const c of camps) {
      if (c.base_pipeline_id) pids.add(String(c.base_pipeline_id));
      if (c.v1_to_pipeline_id) pids.add(String(c.v1_to_pipeline_id));
      if (c.v2_to_pipeline_id) pids.add(String(c.v2_to_pipeline_id));
      if (c.exp_to_pipeline_id) pids.add(String(c.exp_to_pipeline_id));
    }

    const sMap: Record<string, Record<string, string>> = {};
    await Promise.all(
      Array.from(pids).map(async (pid) => {
        const r = await fetch(`/api/keycrm/statuses?pipeline_id=${encodeURIComponent(pid)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const j = await r.json().catch(() => ({}));
        const slist = normStatuses(j);
        const one: Record<string, string> = {};
        slist.forEach(s => { one[String(s.id)] = s.name; });
        sMap[pid] = one;
      })
    );
    setStatusesByPid(sMap);
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      await loadCampaigns();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when items loaded, load dictionaries
  useEffect(() => {
    if (!items.length) return;
    (async () => {
      try { await loadDictionaries(items); } catch {}
    })();
  }, [items]);

  async function onDelete(id: string) {
    if (!confirm('Видалити кампанію?')) return;
    const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) {
      alert('Помилка видалення');
    }
    refresh();
  }

  const rows = useMemo(() => {
    const nameP = (pid?: string | null) => (pid ? pipelines[String(pid)] || pid : '—');
    const nameS = (pid?: string | null, sid?: string | null) =>
      pid && sid ? (statusesByPid[String(pid)]?.[String(sid)] || sid) : '—';

    return items.map((c) => ({
      id: c.id,
      date: fmtDate(c.created_at),
      name: c.name,
      enabled: c.enabled,
      base: `${nameP(c.base_pipeline_id)}/${nameS(c.base_pipeline_id, c.base_status_id)}`,
      v1: c.v1_to_pipeline_id || c.v1_to_status_id
        ? `${nameP(c.v1_to_pipeline_id)}/${nameS(c.v1_to_pipeline_id, c.v1_to_status_id)}`
        : '—',
      v2: c.v2_enabled && (c.v2_to_pipeline_id || c.v2_to_status_id)
        ? `${nameP(c.v2_to_pipeline_id)}/${nameS(c.v2_to_pipeline_id, c.v2_to_status_id)}`
        : '—',
      exp: c.exp_to_pipeline_id || c.exp_to_status_id
        ? `${nameP(c.exp_to_pipeline_id)}/${nameS(c.exp_to_pipeline_id, c.exp_to_status_id)}`
        : '—',
      v1_count: c.v1_count || 0,
      v2_count: c.v2_count || 0,
      exp_count: c.exp_count || 0,
    }));
  }, [items, pipelines, statusesByPid]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-4xl font-black">Кампанії</h1>
        <div className="flex gap-2">
          <Link href="/admin/tools" className="rounded-full border px-4 py-2 text-sm">Інструменти</Link>
          <button onClick={refresh} className="rounded-full border px-4 py-2 text-sm">Оновити</button>
          <Link href="/admin/campaigns/new" className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Нова кампанія</Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border">
        <table className="w-full table-fixed">
          <thead className="bg-gray-50 text-left text-sm">
            <tr>
              <th className="w-44 px-4 py-3">Дата</th>
              <th className="w-56 px-4 py-3">Назва</th>
              <th className="px-4 py-3">Сутність</th>
              <th className="w-40 px-4 py-3">Лічильники</th>
              <th className="w-20 px-4 py-3">Статус</th>
              <th className="w-28 px-4 py-3">Дії</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="px-4 py-4 text-sm text-gray-700">{r.date}</td>
                <td className="px-4 py-4">
                  <div className="font-medium">{r.name}</div>
                </td>
                <td className="px-4 py-4">
                  <div className="text-gray-800">
                    <div className="mb-1"><span className="font-semibold">База:</span> {r.base}</div>
                    <div className="mb-1"><span className="font-semibold">V1 →</span> {r.v1}</div>
                    <div className="mb-1"><span className="font-semibold">V2 →</span> {r.v2}</div>
                    <div className=""><span className="font-semibold">EXP({/* days */}) →</span> {r.exp}</div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-2">
                    <Chip>V1: {r.v1_count}</Chip>
                    <Chip>V2: {r.v2_count}</Chip>
                    <Chip>EXP: {r.exp_count}</Chip>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm">{r.enabled ? 'yes' : 'no'}</td>
                <td className="px-4 py-4 text-sm">
                  <div className="flex gap-3">
                    <Link href={`/admin/campaigns/${r.id}/edit`} className="text-blue-600 hover:underline">Edit</Link>
                    <button onClick={() => onDelete(r.id)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-gray-500" colSpan={6}>
                  Кампаній поки немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
