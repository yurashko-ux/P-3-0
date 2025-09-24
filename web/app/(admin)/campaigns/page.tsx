// web/app/(admin)/campaigns/page.tsx
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
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(
    // екрануємо спецсимволи у назві cookie
    new RegExp('(?:^|;\\s*)' + name.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&') + '=([^;]*)')
  );
  return m ? decodeURIComponent(m[1]) : null;
}

export default function CampaignsPage() {
  const tokenFromCookie = useMemo(() => readCookie('admin_token') || '', []);
  const [token, setToken] = useState(tokenFromCookie);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Campaign[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const t = readCookie('admin_token') || '';
      setToken(t);
      const res = await fetch('/api/campaigns', {
        method: 'GET',
        headers: { 'X-Admin-Token': t },
        cache: 'no-store',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text || 'Failed to load campaigns'}`);
      }
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || 'Unknown API error');
      setItems(json.items || []);
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

      {/* DEBUG-панель по токену */}
      <div className="mb-4 rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
        <div className="mb-1">
          <strong>admin_token (cookie):</strong>{' '}
          <code className="break-all">{token || '— немає'}</code>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            className="rounded-md border border-yellow-300 bg-white px-2 py-1 hover:bg-yellow-100"
            href="/api/auth/set?token=11111"
            title="Встановити admin_token=11111 (cookie)"
          >
            Встановити токен = 11111
          </a>
          <button
            className="rounded-md border border-yellow-300 bg-white px-2 py-1 hover:bg-yellow-100"
            onClick={() => {
              // миттєво оновити відображення токена і список
              setToken(readCookie('admin_token') || '');
              load();
            }}
          >
            Перевірити токен & Перезавантажити
          </button>
          <a
            className="rounded-md border border-yellow-300 bg-white px-2 py-1 hover:bg-yellow-100"
            href="/api/debug/seed"
            title="Переглянути індекс/зразок у KV (тільки діагностика)"
          >
            Перевірити KV /debug/seed
          </a>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-700">
          <div className="font-medium">Не вдалося завантажити кампанії</div>
          <div className="mt-1 text-xs opacity-80">{error}</div>
        </div>
      )}

      {loading && <div className="text-gray-500">Завантаження…</div>}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border p-10 text-center text-gray-500">
          Кампаній поки немає
          <div className="mt-2 text-sm">
            Якщо очікуєш дані — спочатку натисни{' '}
            <a className="text-blue-600 underline" href="/api/auth/set?token=11111">
              встановити токен
            </a>
            , потім «Перевірити токен & Перезавантажити». Для наповнення можна створити через
            UI або скористатись <code>POST /api/debug/seed</code>.
          </div>
        </div>
      )}

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
