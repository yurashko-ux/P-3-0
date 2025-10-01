'use client';

import { useEffect, useState } from 'react';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

export type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: BaseInfo;
  counters?: Counters;
};

export type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

type Props = {
  initial?: ApiList;
};

export default function ClientList({ initial }: Props) {
  const [data, setData] = useState<ApiList>(initial ?? { ok: true, items: [], count: 0 });
  const items = data.items ?? [];

  // клієнтське оновлення списку (без кешу)
  useEffect(() => {
    if (initial?.items?.length) return;
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json: ApiList = await res.json();
        if (json?.ok) setData(json);
      } catch {
        /* ignore */
      }
    })();
  }, [initial]);

  return (
    <div className="w-full">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-2 pr-4">Дата/ID</th>
            <th className="py-2 pr-4">Назва</th>
            <th className="py-2 pr-4">Сутність</th>
            <th className="py-2 pr-4">Воронка</th>
            <th className="py-2 pr-4">Лічильник</th>
            <th className="py-2 pr-2 text-right">Дії</th>
          </tr>
        </thead>

        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-gray-500">
                Кампаній поки немає
              </td>
            </tr>
          )}

          {items.map((row) => {
            const v1 = row.v1 ?? '—';
            const v2 = row.v2 ?? '—';
            const pipe = row.base?.pipelineName ?? row.base?.pipeline ?? '#—';
            const counters = row.counters ?? {};
            const name = row.name ?? '—';

            return (
              <tr key={row.id} className="border-t">
                <td className="py-3 pr-4 align-top">
                  <div>—</div>
                  <div className="text-sm text-gray-500">ID: {row.id}</div>
                </td>

                <td className="py-3 pr-4 align-top">{name}</td>

                <td className="py-3 pr-4 align-top">v1: {v1} · v2: {v2}</td>

                <td className="py-3 pr-4 align-top">{pipe}</td>

                <td className="py-3 pr-4 align-top whitespace-nowrap">
                  v1: {counters.v1 ?? 0} · v2: {counters.v2 ?? 0} · exp: {counters.exp ?? 0}
                </td>

                <td className="py-3 pl-4 align-top text-right">
                  {/* submit-форма на POST /api/campaigns/delete */}
                  <form action="/api/campaigns/delete" method="post">
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
                      aria-label={`Видалити кампанію ${row.id}`}
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
    </div>
  );
}
