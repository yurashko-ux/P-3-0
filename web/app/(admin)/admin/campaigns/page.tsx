// web/app/(admin)/admin/campaigns/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Counters = { v1: number; v2: number; exp: number };

type Target = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

type Campaign = {
  id: string;
  name?: string;
  createdAt?: number;

  base?: {
    pipeline?: string;
    status?: string;
    pipelineName?: string;
    statusName?: string;
  };

  targets?: {
    v1?: Target;
    v2?: Target;
    exp?: Target;
  };

  v1?: string | number;
  v2?: string | number;

  counters?: Counters;
};

function fmtDate(n?: number) {
  if (!n) return '—';
  const d = new Date(Number(n));
  return `${d.toLocaleDateString('uk-UA')} ${d
    .toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    .replace(':', ':')}`;
}

function CellStack({
  rows,
  labels,
}: {
  rows: Array<string | number | undefined>;
  labels?: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((v, i) => (
        <div key={i} className="flex items-baseline gap-2">
          {labels?.[i] ? (
            <span className="w-8 shrink-0 text-gray-400">{labels[i]}</span>
          ) : null}
          <span>{v ?? '—'}</span>
        </div>
      ))}
    </div>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
    >
      {children}
    </span>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const hasData = useMemo(() => items.length > 0, [items]);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/campaigns', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Помилка завантаження');
      setItems(j.items ?? []);
    } catch (e: any) {
      setErr(e?.message || 'Помилка завантаження');
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
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-4xl font-extrabold">Кампанії</h1>
        <div className="flex gap-3">
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

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Дата</th>
              <th className="px-4 py-3 text-left">Назва</th>
              <th className="px-4 py-3 text-left">Базова Воронка</th>
              <th className="px-4 py-3 text-left">Базовий Статус</th>
              <th className="px-4 py-3 text-left">Цільва воронка</th>
              <th className="px-4 py-3 text-left">Цільовий статус</th>
              <th className="px-4 py-3 text-left">Лічильник</th>
              <th className="px-4 py-3 text-right">Дії</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-10 text-center" colSpan={8}>
                  Завантаження…
                </td>
              </tr>
            ) : !hasData ? (
              <tr>
                <td className="px-4 py-12 text-center text-gray-500" colSpan={8}>
                  Кампаній поки немає
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const c: Counters = it.counters ?? { v1: 0, v2: 0, exp: 0 };
                const tV1 = it.targets?.v1;
                const tV2 = it.targets?.v2;
                const tExp = it.targets?.exp;

                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{fmtDate(it.createdAt)}</span>
                        <span className="text-gray-400">#{it.id}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3">{it.name || <span className="text-gray-400">без назви</span>}</td>

                    <td className="px-4 py-3">{it.base?.pipelineName ?? '—'}</td>

                    <td className="px-4 py-3">{it.base?.statusName ?? '—'}</td>

                    <td className="px-4 py-3">
                      <CellStack
                        labels={['V1', 'V2', 'EXP']}
                        rows={[
                          tV1?.pipelineName ?? '—',
                          tV2?.pipelineName ?? '—',
                          tExp?.pipelineName ?? '—',
                        ]}
                      />
                    </td>

                    <td className="px-4 py-3">
                      <CellStack
                        labels={['V1', 'V2']}
                        rows={[tV1?.statusName ?? '—', tV2?.statusName ?? '—']}
                      />
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Chip title="Лічильник V1">V1: {c.v1 ?? 0}</Chip>
                        <Chip title="Лічильник V2">V2: {c.v2 ?? 0}</Chip>
                        <Chip title="Дні до експірації">EXP: {c.exp ?? 0}</Chip>
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
