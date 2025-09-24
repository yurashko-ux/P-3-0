// web/app/(admin)/campaigns/page.tsx
'use client';

import { useEffect, useState } from 'react';

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
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&') + '=([^;]*)')
  );
  return m ? decodeURIComponent(m[1]) : null;
}

export default function CampaignsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Campaign[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = readCookie('admin_token') || '';
      const res = await fetch('/api/campaigns', {
        method: 'GET',
        headers: { 'X-Admin-Token': token },
        cache: 'no-store',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json = await res.json();
      if (!json?.ok) {
        throw new Error(json?.error || 'Unknown API error');
      }
      setItems(json.items || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-lg border px-3 py-1 hover:bg-gray-50"
            title="Оновити список"
          >
            Оновити
          </button>
          <a
            href="/admin/campaigns/new"
            className="rounded-lg bg-blue-600 text-white px-3 py-1 hover:bg-blue-700"
          >
            Нова кампанія
          </a>
        </div>
      </div>

      {/* підказка по токену */}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border p-10 text-center text-gray-500">
          Кампаній поки немає
          <div className="mt-2 text-sm">
            Якщо очікуєш дані, переконайся, що встановлено cookie{' '}
            <code>admin_token</code>. Швидка перевірка: відкрий{' '}
            <a
              className="text-blue-600 underline"
              href="/api/auth/set?token=11111"
            >
              /api/auth/set?token=11111
            </a>{' '}
            і повернись на цю сторінку.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 text-red-700 p-4">
          Не вдалося завантажити кампанії. <br />
          <span className="text-sm opacity-80">{error}</span>
        </div>
      )}

      {loading && <div className="text-gray-500">Завантаження…</div>}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-3">Дата</th>
                <th className="text-left p-3">Назва</th>
                <th className="text-left p-3">Сутність</th>
                <th className="text-left p-3">Воронка</th>
                <th className="text-left p-3">Лічильник</th>
                <th className="text-left p-3">Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const date = c.created_at
                  ? new Date(c.created_at).toLocaleString('uk-UA')
                  : '—';
                const pipeline =
                  (c.base_pipeline_name || c.base_pipeline_id || '—') +
                  ' → ' +
                  (c.base_status_name || c.base_status_id || '—');
                const rules = [
                  c.rules?.v1?.value ? `V1: ${c.rules?.v1?.op} "${c.rules?.v1?.value}"` : null,
                  c.rules?.v2?.value ? `V2: ${c.rules?.v2?.op} "${c.rules?.v2?.value}"` : null,
                ]
                  .filter(Boolean)
                  .join(' | ');

                return (
                  <tr key={String(c.id)} className="border-t">
                    <td className="p-3">{date}</td>
                    <td className="p-3">{c.name || '—'}</td>
                    <td className="p-3">{rules || '—'}</td>
                    <td className="p-3">{pipeline}</td>
                    <td className="p-3">
                      {c.v1_count ?? 0} / {c.v2_count ?? 0} / {c.exp_count ?? 0}
                    </td>
                    <td className="p-3">
                      <a
                        className="text-blue-600 hover:underline mr-3"
                        href={`/admin/campaigns/${c.id}/edit`}
                      >
                        Edit
                      </a>
                      <a
                        className="text-red-600 hover:underline"
                        href={`/admin/campaigns/${c.id}/delete`}
                      >
                        Delete
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
