// web/app/admin/campaigns/page.tsx
'use client';

import React, { useEffect, useState } from 'react';

type Op = 'contains' | 'equals';
type Campaign = {
  id: string;
  created_at: string | number;
  updated_at?: string | number;
  name: string;
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

  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
};

function fmtDate(v: string | number) {
  const ms = typeof v === 'number' ? v : Date.parse(String(v));
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs text-gray-600">
      {children}
    </span>
  );
}

export default function Page() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/campaigns', { credentials: 'include', cache: 'no-store' });
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(id: string) {
    if (!confirm('Видалити кампанію?')) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-4xl font-extrabold tracking-tight">Кампанії</h1>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-full border px-3 py-1.5 text-sm"
            disabled={loading}
          >
            Оновити
          </button>
          <a
            href="/admin/campaigns/new"
            className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Нова кампанія
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border">
        <table className="min-w-full table-auto text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-[180px] px-4 py-3 text-left font-semibold text-gray-700">Дата</th>
              <th className="w-[160px] px-4 py-3 text-left font-semibold text-gray-700">Назва</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Сутність</th>
              <th className="w-[140px] px-4 py-3 text-left font-semibold text-gray-700">Лічильники</th>
              <th className="w-[80px] px-4 py-3 text-left font-semibold text-gray-700">Статус</th>
              <th className="w-[120px] px-4 py-3 text-left font-semibold text-gray-700">Дії</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((c) => (
              <tr key={c.id} className="align-top">
                {/* Дата */}
                <td className="px-4 py-4 text-gray-800">{fmtDate(c.created_at)}</td>

                {/* Назва */}
                <td className="px-4 py-4 font-semibold text-gray-900">{c.name || '—'}</td>

                {/* Сутність */}
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-1.5 text-gray-800">
                    <div className="font-semibold">База:</div>
                    <div><span className="font-semibold">V1 →</span> {c.v1_value ? c.v1_value : '—'}/</div>
                    <div><span className="font-semibold">V2 →</span> {c.v2_enabled ? (c.v2_value || '—') : '—'}/</div>
                    <div><span className="font-semibold">EXP({c.exp_days || 0}д) →</span> </div>
                  </div>
                </td>

                {/* Лічильники — щільно вирівняні під V1/V2/EXP */}
                <td className="px-4 py-4 align-top">
                  <div className="grid grid-rows-[1rem,auto,auto,auto] gap-1">
                    <div aria-hidden />
                    <div><Chip>V1: {c.v1_count ?? 0}</Chip></div>
                    <div><Chip>V2: {c.v2_count ?? 0}</Chip></div>
                    <div><Chip>EXP: {c.exp_count ?? 0}</Chip></div>
                  </div>
                </td>

                {/* Статус */}
                <td className="px-4 py-4">{c.enabled ? 'yes' : 'no'}</td>

                {/* Дії */}
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <a className="text-blue-700 hover:underline" href={`/admin/campaigns/${c.id}/edit`}>Edit</a>
                    <button onClick={() => onDelete(c.id)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  {loading ? 'Завантаження…' : 'Кампаній поки немає'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
