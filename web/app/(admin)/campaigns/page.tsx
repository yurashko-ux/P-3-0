'use client';

import { useEffect, useMemo, useState } from 'react';

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Campaign = {
  id?: string | number;
  name?: string;
  created_at?: number;
  active?: boolean;

  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;

  rules?: { v1?: Rule; v2?: Rule };
  exp?: Record<string, unknown>;

  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function readCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&') + '=([^;]*)')
  );
  return m ? decodeURIComponent(m[1]) : null;
}

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>('');

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    []
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const t = readCookie('admin_token') || '';
      setToken(t);

      // фолбек: передамо токен і в query, і в заголовку
      const url = t ? `/api/campaigns?token=${encodeURIComponent(t)}` : `/api/campaigns`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-Admin-Token': t || '' },
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text || 'Failed to load campaigns'}`);
      }

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Unknown API error');

      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold">Кампанії</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="rounded-xl px-4 py-2 border hover:bg-gray-50"
            title="Оновити"
          >
            Оновити
          </button>
          <a
            href="/admin/campaigns/new"
            className="rounded-xl px-4 py-2 bg-blue-600 text-white hover:bg-blue-700"
          >
            Нова кампанія
          </a>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        Токен: {token ? <code>{token}</code> : <em>не знайдено</em>}{' '}
        <a
          className="underline"
          href="/api/auth/set?token=11111"
          title="Встановити cookie admin_token=11111"
        >
          встановити cookie
        </a>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-3">Дата</th>
              <th className="p-3">Назва</th>
              <th className="p-3">Сутність</th>
              <th className="p-3">Воронка</th>
              <th className="p-3">Лічильник</th>
              <th className="p-3">Дії</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-gray-500">
                  Кампаній поки немає
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={String(c.id)} className="border-t">
                <td className="p-3">
                  {c.created_at ? fmt.format(new Date(c.created_at)) : '—'}
                </td>
                <td className="p-3 font-medium">{c.name || '—'}</td>
                <td className="p-3">
                  База / V1 / EXP
                </td>
                <td className="p-3">
                  {(c.base_pipeline_name || c.base_pipeline_id || '—') as any} →{' '}
                  {(c.base_status_name || c.base_status_id || '—') as any}
                </td>
                <td className="p-3">
                  {(c.v1_count || 0) + (c.v2_count || 0) + (c.exp_count || 0)}
                </td>
                <td className="p-3">
                  <a
                    className="text-blue-600 hover:underline mr-3"
                    href={`/admin/campaigns/${c.id}`}
                  >
                    Edit
                  </a>
                </td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  Завантаження…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
