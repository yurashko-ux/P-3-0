'use client';

import { useEffect, useState } from 'react';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
export type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: BaseInfo;
  counters?: Counters;
};

export type ApiList = { ok: boolean; items: Campaign[]; count: number };

export default function ClientList() {
  const [data, setData] = useState<ApiList>({ ok: true, items: [], count: 0 });
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const json: ApiList = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  async function seedAndReload() {
    setLoading(true);
    try {
      await fetch('/api/campaigns?seed=1', { cache: 'no-store' });
      await load();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="w-full">
      {/* Порожній стан з кнопкою сіду */}
      {data.count === 0 && !loading ? (
        <div className="py-8 text-center text-slate-600">
          <div className="mb-4">Кампаній поки немає</div>
          <button
            onClick={seedAndReload}
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
          >
            Додати тестову
          </button>
        </div>
      ) : null}

      {/* Таблиця (коли є дані або йде завантаження) */}
      {data.count > 0 ? (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr className="border-b">
              <th className="py-2 pr-4">Дата/ID</th>
              <th className="py-2 pr-4">Назва</th>
              <th className="py-2 pr-4">Сутність</th>
              <th className="py-2 pr-4">Воронка</th>
              <th className="py-2 pr-4">Лічильник</th>
              <th className="py-2 pr-4">Дії</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => {
              const c = item.counters || {};
              const b = item.base || {};
              return (
                <tr key={item.id} className="border-b align-top">
                  <td className="py-2 pr-4">
                    —<div className="text-slate-400 text-xs">ID: {item.id}</div>
                  </td>
                  <td className="py-2 pr-4">{item.name || '—'}</td>
                  <td className="py-2 pr-4">
                    v1: {item.v1 || '—'} · v2: {item.v2 || '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {b.pipelineName || b.pipeline || '—'}
                    <div className="text-slate-400 text-xs">
                      {b.statusName || b.status || '—'}
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    v1: {c.v1 ?? 0} · v2: {c.v2 ?? 0} · exp: {c.exp ?? 0}
                  </td>
                  <td className="py-2 pr-4">
                    {/* Синхронний сабміт на /api/campaigns/delete (метод POST) */}
                    <form action="/api/campaigns/delete" method="post">
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
                      >
                        Видалити
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {loading ? (
        <div className="py-6 text-center text-slate-400">Завантаження…</div>
      ) : null}

      {/* Кнопка ручного оновлення */}
      <div className="mt-4">
        <button
          onClick={load}
          className="rounded border px-3 py-1.5 hover:bg-slate-50"
        >
          Оновити
        </button>
      </div>
    </div>
  );
}
