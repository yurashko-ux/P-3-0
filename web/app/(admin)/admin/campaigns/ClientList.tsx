// web/app/(admin)/admin/campaigns/ClientList.tsx
'use client';

import { useEffect, useState } from 'react';

export type Counters = { v1?: number; v2?: number; exp?: number };
export type BaseInfo = {
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
  deleted?: boolean;
  createdAt?: number;
};

type ApiList = { ok: boolean; items: Campaign[] };

export default function ClientList() {
  const [rows, setRows] = useState<Campaign[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/campaigns', { cache: 'no-store' });
        const j: ApiList = await r.json();
        if (alive) setRows(j.items ?? []);
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (rows === null) {
    return (
      <tbody>
        <tr>
          <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
            Завантаження…
          </td>
        </tr>
      </tbody>
    );
  }

  if (!rows.length) {
    return (
      <tbody>
        <tr>
          <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
            Кампаній поки немає
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {rows.map((it) => {
        const cnt = it.counters || {};
        const base = it.base || {};
        return (
          <tr key={it.id} className="border-t">
            <td className="px-3 py-2 align-top">
              <div className="text-gray-700">—</div>
              <div className="text-xs text-gray-500">ID: {it.id}</div>
            </td>
            <td className="px-3 py-2 align-top">{it.name ?? '—'}</td>
            <td className="px-3 py-2 align-top">
              v1: {it.v1 ?? '—'} · v2: {it.v2 ?? '—'}
            </td>
            <td className="px-3 py-2 align-top">
              {base.pipelineName ? `${base.pipelineName} — ${base.statusName ?? '—'}` : '—'}
            </td>
            <td className="px-3 py-2 align-top">
              v1: {cnt.v1 ?? 0} · v2: {cnt.v2 ?? 0} · exp: {cnt.exp ?? 0}
            </td>
            <td className="px-3 py-2 align-top">
              {/* Без клієнтських onClick: проста форма POST -> /api/campaigns/delete */}
              <form method="post" action="/api/campaigns/delete">
                <input type="hidden" name="id" value={it.id} />
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
  );
}
