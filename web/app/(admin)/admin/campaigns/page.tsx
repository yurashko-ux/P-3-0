// web/app/(admin)/admin/campaigns/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Counters = { v1: number; v2: number; exp: number };
type Base = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
type Item = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: Base;
  counters?: Counters;
  createdAt?: number;
};

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs leading-5"
    >
      {children}
    </span>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-400">{children}</span>;
}

function formatDate(n?: number) {
  if (!n) return '—';
  try {
    const d = new Date(Number(n));
    const dd = d.toLocaleDateString('uk-UA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const tt = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    return `${dd} ${tt}`;
  } catch {
    return String(n);
  }
}

export default function CampaignsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const hasData = useMemo(() => (items || []).length > 0, [items]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/campaigns', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Помилка завантаження');
      setItems(j.items || []);
    } catch (e: any) {
      setError(e?.message || 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(id: string) {
    if (!confirm('Видалити кампанію?')) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не вдалося видалити');
      await load();
    } catch (e: any) {
      alert(e?.message || 'Помилка видалення');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-4xl font-extrabold tracking-tight">Кампанії</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/admin/campaigns/new')}
            className="rounded-md bg-blue-600 px-4 py-2 text-white"
          >
            + Нова кампанія
          </button>
          <button onClick={() => load()} className="rounded-md border px-4 py-2">
            Оновити
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Дата/ID</th>
              <th className="px-4 py-3 text-left">Назва</th>
              <th className="px-4 py-3 text-left">Сутність</th>
              <th className="px-4 py-3 text-left">Воронка</th>
              <th className="px-4 py-3 text-left">Лічильник</th>
              <th className="px-4 py-3 text-right">Дії</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-8 text-center" colSpan={6}>
                  Завантаження…
                </td>
              </tr>
            ) : !hasData ? (
              <tr>
                <td className="px-4 py-12 text-center text-gray-500" colSpan={6}>
                  Кампаній поки немає
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const created = formatDate(it.createdAt);
                const pipelineName = it.base?.pipelineName || '—';
                const statusName = it.base?.statusName || '—';
                const v1 = it.v1 ?? '—';
                const v2 = it.v2 ?? '—';
                const c = it.counters || { v1: 0, v2: 0, exp: 0 };

                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{created}</span>
                        <Muted>#{it.id}</Muted>
                      </div>
                    </td>

                    <td className="px-4 py-3">{it.name || <Muted>без назви</Muted>}</td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Chip title="Значення 1">v1: {v1}</Chip>
                        <Chip title="Значення 2">v2: {v2}</Chip>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {pipelineName !== '—' ? (
                        <div className="flex flex-col">
                          <span className="font-medium" title={it.base?.pipeline}>
                            {pipelineName}
                          </span>
                          <Muted title={it.base?.status}>{statusName}</Muted>
                        </div>
                      ) : (
                        <Muted>—</Muted>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Chip title="Лічильник v1">v1: {c.v1 ?? 0}</Chip>
                        <Chip title="Лічильник v2">v2: {c.v2 ?? 0}</Chip>
                        <Chip title="Дні до експірації">exp: {c.exp ?? 0}</Chip>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onDelete(it.id)}
                        disabled={busyId === it.id}
                        className="rounded-md bg-red-600 px-3 py-2 text-white disabled:opacity-60"
                      >
                        {busyId === it.id ? '...' : 'Видалити'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
