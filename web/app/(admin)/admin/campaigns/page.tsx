// web/app/(admin)/admin/campaigns/page.tsx

export const dynamic = 'force-dynamic';

type Campaign = {
  id: string;
  name?: string;
  created_at?: number;
  base_pipeline_name?: string;
  base_status_name?: string;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

export default function CampaignsPage() {
  return (
    <div className="px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Кампанії</h1>
        <a
          href="/admin/campaigns/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700"
        >
          + Нова кампанія
        </a>
      </div>

      <div className="mt-4">
        <ClientList />
      </div>
    </div>
  );
}

/* ----------------------------------------- */
/* КЛІЄНТСЬКИЙ РЕНДЕР — безпечний, з автосідом */
/* ----------------------------------------- */

'use client';
import { useEffect, useMemo, useState } from 'react';

type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

function countsText(c: Campaign) {
  return `v1: ${c.v1_count ?? 0} · v2: ${c.v2_count ?? 0} · exp: ${c.exp_count ?? 0}`;
}

function formatDate(ts?: number) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

export function ClientList() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(0);

  async function safeJson<T>(input: RequestInfo, init?: RequestInit): Promise<T | null> {
    try {
      const r = await fetch(input, { cache: 'no-store', ...init });
      if (!r.ok) return null;
      const text = await r.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  async function load() {
    setLoading(true);
    setErr(null);

    // 1) пробуємо звичайний список
    let res = await safeJson<ApiList>('/api/campaigns');
    if (!res?.ok) {
      // 2) якщо зламалось — не валимо UI, просто res = null
      res = null;
    }

    // 3) якщо порожньо — сідимо одну кампанію і пробуємо ще раз
    if (!res?.items || res.items.length === 0) {
      await safeJson('/api/campaigns?seed=1');
      res = await safeJson<ApiList>('/api/campaigns');
    }

    if (res?.items && Array.isArray(res.items)) {
      setItems(res.items);
      setTotal(res.count ?? res.items.length);
      setLoading(false);
      return;
    }

    // 4) зовсім fallback
    setItems([]);
    setTotal(0);
    setLoading(false);
    setErr('Не вдалося завантажити кампанії (відповідь API порожня).');
  }

  useEffect(() => {
    load();
  }, []);

  const body = useMemo(() => {
    if (loading) {
      return (
        <tr>
          <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
            Завантаження…
          </td>
        </tr>
      );
    }

    if (!items || items.length === 0) {
      return (
        <tr>
          <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
            Кампаній поки немає
          </td>
        </tr>
      );
    }

    return items.map((c) => (
      <tr key={c.id}>
        <td className="px-4 py-3 text-sm text-gray-700">
          <div className="flex flex-col">
            <span>{formatDate(c.created_at)}</span>
            <span className="text-gray-400">ID: {c.id}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-gray-900">{c.name || '—'}</td>
        <td className="px-4 py-3 text-sm text-gray-700">
          {c.base_status_name ? `статус: ${c.base_status_name}` : '—'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700">
          {c.base_pipeline_name || '—'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700">{countsText(c)}</td>
      </tr>
    ));
  }, [items, loading]);

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-gray-500">Всього:</span>
        <span className="font-medium">{total}</span>
        <button
          onClick={load}
          className="ml-auto rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Оновити
        </button>
      </div>

      {err && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {err}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Дата/ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Назва</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Сутність</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Воронка</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Лічильник</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">{body}</tbody>
        </table>
      </div>
    </>
  );
}
