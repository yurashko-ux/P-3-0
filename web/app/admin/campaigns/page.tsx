// web/app/admin/campaigns/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Campaign = any;

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/campaigns', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const j: any = await r.json().catch(() => ({}));
        const arr =
          Array.isArray(j?.items) ? j.items :
          Array.isArray(j?.data) ? j.data :
          Array.isArray(j?.result) ? j.result :
          Array.isArray(j) ? j : [];
        setItems(arr);
      } catch (e: any) {
        setErr(e?.message || 'load failed');
        setItems([]); // все одно рендеримо сторінку
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <Link href="/admin/campaigns/new" className="rounded-xl px-4 py-2 border bg-blue-600 text-white">
          Нова кампанія
        </Link>
      </div>

      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('created') && (
        <div className="rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-sm">
          Кампанію створено успішно.
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm">
          Не вдалося завантажити список ({err}). Сторінка працює, можна створювати нові.
        </div>
      )}

      {items === null ? (
        <div>Завантаження…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">Поки що порожньо.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-4">Назва</th>
                <th className="py-2 pr-4">База</th>
                <th className="py-2 pr-4">Куди (V1)</th>
                <th className="py-2 pr-4">Expire (дні)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c: any, i: number) => (
                <tr key={c?.id ?? i} className="border-t">
                  <td className="py-2 pr-4">{c?.name ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {c?.base_pipeline_id ?? '—'}/{c?.base_status_id ?? '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {c?.v1_to_pipeline_id ?? '—'}/{c?.v1_to_status_id ?? '—'}
                  </td>
                  <td className="py-2 pr-4">{c?.exp_days ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
