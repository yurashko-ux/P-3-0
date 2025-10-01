// /app/(admin)/admin/campaigns/ClientList.tsx
'use client';

import { useEffect, useState, useTransition } from 'react';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Rule = { rule: string | null; value: string | null };

export type Campaign = {
  id: string;
  name?: string;
  base?: BaseInfo;
  v1?: Rule;
  v2?: Rule;
  counters?: Counters;
};

export type ApiList = { ok: boolean; items?: Campaign[]; error?: string };

export default function ClientList({ initial }: { initial: ApiList }) {
  const [data, setData] = useState<ApiList>(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json = (await res.json()) as ApiList;
        setData(json);
      } catch {
        // ignore
      }
    });
  }, []);

  if (!data?.items?.length) {
    return (
      <tr>
        <td colSpan={6} className="py-10 text-center text-slate-500">
          Кампаній поки немає
        </td>
      </tr>
    );
  }

  return (
    <>
      {data.items.map((item) => (
        <tr key={item.id} className="border-b">
          <td className="py-3 align-top text-slate-500">
            —<div className="text-xs">ID: {item.id}</div>
          </td>
          <td className="py-3 align-top">{item.name || '—'}</td>
          <td className="py-3 align-top">
            v1: {item?.v1?.value ?? '—'} · v2: {item?.v2?.value ?? '—'}
          </td>
          <td className="py-3 align-top">
            {item?.base?.pipelineName || item?.base?.pipeline || '#—'}
          </td>
          <td className="py-3 align-top">
            v1: {item?.counters?.v1 ?? 0} · v2: {item?.counters?.v2 ?? 0} · exp: {item?.counters?.exp ?? 0}
          </td>
          <td className="py-3 align-top">
            <form action="/api/campaigns/delete" method="post">
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
              >
                {isPending ? '...' : 'Видалити'}
              </button>
            </form>
          </td>
        </tr>
      ))}
    </>
  );
}
