'use client';

import React from 'react';
import type { Campaign } from '@/lib/types';

type ApiList = { ok: boolean; items: Campaign[] };

export default function ClientCampaignsTable() {
  const [items, setItems] = React.useState<Campaign[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const data: ApiList = await res.json();
      setItems(data?.items ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Помилка завантаження');
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function seed() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns/seed', { method: 'POST' });
      await res.json();
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Помилка створення');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Видалити кампанію?')) return;
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/campaigns/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Помилка видалення');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex gap-2 justify-end mb-4">
        <button
          onClick={seed}
          className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50"
          disabled={busy}
        >
          + Нова кампанія
        </button>
        <button
          onClick={load}
          className="px-4 py-2 rounded-md bg-gray-100"
          disabled={busy}
        >
          Оновити
        </button>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-4 w-[14%]">Дата/ID</th>
              <th className="text-left p-4 w-[20%]">Назва</th>
              <th className="text-left p-4 w-[20%]">Сутність</th>
              <th className="text-left p-4 w-[20%]">Воронка</th>
              <th className="text-left p-4 w-[16%]">Лічильник</th>
              <th className="text-left p-4 w-[10%]">Дії</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={6} className="p-6 text-red-600">
                  {error}
                </td>
              </tr>
            )}

            {items && items.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  Кампаній поки немає
                </td>
              </tr>
            )}

            {!items && !error && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  Завантаження…
                </td>
              </tr>
            )}

            {items?.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-4 align-top">
                  <div className="font-mono">{c.id}</div>
                </td>
                <td className="p-4 align-top">{c.name || '—'}</td>
                <td className="p-4 align-top">
                  v1: {c.v1 ?? '—'} · v2: {c.v2 ?? '—'}
                </td>
                <td className="p-4 align-top">
                  {c.base?.pipelineName || '—'}
                  <div className="text-xs text-gray-500">
                    {c.base?.statusName || '—'}
                  </div>
                </td>
                <td className="p-4 align-top">
                  v1: {c.counters?.v1 ?? 0} · v2: {c.counters?.v2 ?? 0} · exp:{' '}
                  {c.counters?.exp ?? 0}
                </td>
                <td className="p-4 align-top">
                  <button
                    onClick={() => remove(String(c.id))}
                    className="px-3 py-1 rounded-md bg-red-600 text-white disabled:opacity-50"
                    disabled={busy}
                  >
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
