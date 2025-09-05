// src/app/admin/campaigns/page.tsx
'use client';

import { useEffect, useState } from 'react';

type Campaign = {
  id: string;
  created_at: string;
  from_pipeline_id: string;
  from_status_id: string;
  to_pipeline_id: string;
  to_status_id: string;
  expires_at?: string | null;
  note?: string | null;
  enabled: boolean;
};

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Помилка завантаження');
        setItems(json.items || []);
      } catch (e: any) {
        setErr(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <a href="/admin/campaigns/new" className="px-4 py-2 rounded-md bg-black text-white">
          New
        </a>
      </div>

      {loading && <div>Завантаження…</div>}
      {err && <div className="border border-red-300 text-red-700 p-3 rounded">{err}</div>}

      {!loading && !err && (
        items.length ? (
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Створено</th>
                  <th className="text-left p-2">Умова</th>
                  <th className="text-left p-2">Дія</th>
                  <th className="text-left p-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="p-2">
                      {c.from_pipeline_id} / {c.from_status_id}
                    </td>
                    <td className="p-2">
                      → {c.to_pipeline_id} / {c.to_status_id}
                    </td>
                    <td className="p-2">{c.enabled ? 'enabled' : 'disabled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-500">Кампаній ще немає. Натисни “New”.</div>
        )
      )}
    </main>
  );
}
