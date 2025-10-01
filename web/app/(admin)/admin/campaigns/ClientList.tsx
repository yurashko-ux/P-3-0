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
export type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

function unwrapDeep<T = any>(v: any): T {
  if (v == null) return v;
  let cur = v;
  while (cur && typeof cur === 'object' && 'value' in cur) cur = (cur as any).value;
  if (typeof cur === 'string') {
    const s = cur.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return JSON.parse(s); } catch {}
    }
  }
  return cur as T;
}

export default function ClientList({ initial }: { initial?: ApiList }) {
  const [data, setData] = useState<ApiList>(initial ?? { ok: true, items: [], count: 0 });
  const items = data.items ?? [];

  useEffect(() => {
    if (initial?.items?.length) return;
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json: ApiList = await res.json();
        if (json?.ok) setData(json);
      } catch {}
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
            <th className="py-2 pl-4 text-right">Дії</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-gray-500">Кампаній поки немає</td>
            </tr>
          )}

          {items.map((row) => {
            // додаткове розпакування — на випадок, якщо API все ж повернув “сирі” значення
            const id = String(unwrapDeep(row.id ?? ''));
            const name = unwrapDeep<string>(row.name ?? '') || '—';
            const v1 = unwrapDeep<string>(row.v1 ?? '') || '—';
            const v2 = unwrapDeep<string>(row.v2 ?? '') || '—';

            const baseRaw = unwrapDeep<any>(row.base ?? {});
            const pipelineName = unwrapDeep<string>(baseRaw?.pipelineName ?? baseRaw?.pipeline ?? '') || '#—';

            const cRaw = unwrapDeep<any>(row.counters ?? {});
            const c1 = Number(unwrapDeep(cRaw?.v1 ?? 0) || 0);
            const c2 = Number(unwrapDeep(cRaw?.v2 ?? 0) || 0);
            const exp = Number(unwrapDeep(cRaw?.exp ?? 0) || 0);

            return (
              <tr key={id} className="border-t">
                <td className="py-3 pr-4 align-top">
                  <div>—</div>
                  <div className="text-sm text-gray-500">ID: {id}</div>
                </td>
                <td className="py-3 pr-4 align-top">{name}</td>
                <td className="py-3 pr-4 align-top">v1: {v1} · v2: {v2}</td>
                <td className="py-3 pr-4 align-top">{pipelineName}</td>
                <td className="py-3 pr-4 align-top whitespace-nowrap">v1: {c1} · v2: {c2} · exp: {exp}</td>
                <td className="py-3 pl-4 align-top text-right">
                  <form action="/api/campaigns/delete" method="post">
                    <input type="hidden" name="id" value={id} />
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
    </div>
  );
}
