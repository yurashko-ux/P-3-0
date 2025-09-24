// web/app/(admin)/campaigns/page.tsx
'use client';

import React from 'react';

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Rules = { v1?: Rule; v2?: Rule };
type Campaign = {
  id?: string | number;
  name?: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: Rules;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

export default function CampaignsPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<Campaign[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <div className="flex items-center gap-2">
          <a
            href="/admin/campaigns/new"
            className="rounded-lg px-3 py-2 border hover:bg-gray-50"
          >
            + Нова кампанія
          </a>
          <button
            onClick={load}
            className="rounded-lg px-3 py-2 border hover:bg-gray-50"
            disabled={loading}
          >
            {loading ? 'Оновлюю…' : 'Оновити'}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700">
          Помилка: {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="rounded-lg border bg-white p-6 text-gray-600">
          Кампаній поки немає. Створи першу 👆
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Назва</th>
                <th className="px-4 py-2">База (V1)</th>
                <th className="px-4 py-2">V1 правило</th>
                <th className="px-4 py-2">V2 правило</th>
                <th className="px-4 py-2">Лічильники</th>
                <th className="px-4 py-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {items
                .slice()
                .sort((a, b) => (Number(b.created_at) - Number(a.created_at)))
                .map((c) => {
                  const v1 = c.rules?.v1;
                  const v2 = c.rules?.v2;
                  const pipeline =
                    c.base_pipeline_name ?? c.base_pipeline_id ?? '—';
                  const status =
                    c.base_status_name ?? c.base_status_id ?? '—';

                  const fmtRule = (r?: Rule) =>
                    r?.op && (r.value ?? r.value === '')
                      ? `${r.op} ${JSON.stringify(r.value)}`
                      : '—';

                  return (
                    <tr key={String(c.id ?? c.created_at)} className="border-b last:border-b-0">
                      <td className="px-4 py-2 text-gray-500">{c.id ?? c.created_at ?? '—'}</td>
                      <td className="px-4 py-2">{c.name ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className="whitespace-nowrap">
                          {pipeline} → {status}
                        </span>
                      </td>
                      <td className="px-4 py-2">{fmtRule(v1)}</td>
                      <td className="px-4 py-2">{fmtRule(v2)}</td>
                      <td className="px-4 py-2 text-gray-600">
                        V1: {c.v1_count ?? 0} · V2: {c.v2_count ?? 0} · EXP: {c.exp_count ?? 0}
                      </td>
                      <td className="px-4 py-2">
                        {c.active ? (
                          <span className="rounded bg-green-100 px-2 py-1 text-green-700">active</span>
                        ) : (
                          <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">inactive</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
