// web/app/(admin)/admin/campaigns/ClientList.tsx
'use client';

import { useEffect, useState } from 'react';

type Counters = { v1?: number; v2?: number; exp?: number };

export type Campaign = {
  id: string;
  name?: string;
  // гнучке джерело для базової воронки/статусу
  base?: {
    pipeline?: string;
    status?: string;
    pipelineName?: string;
    statusName?: string;
  };
  v1?: string;
  v2?: string;
  counters?: Counters;
};

// /api/campaigns => { ok: boolean; items?: any[]; count?: number }
export type ApiList = {
  ok: boolean;
  items?: any[];
  count?: number;
};

function unwrapDeep(val: any): any {
  // 1) { value: ... } -> ...
  if (val && typeof val === 'object' && 'value' in val) {
    try {
      // якщо value — JSON-рядок
      const maybe = (val as any).value;
      if (typeof maybe === 'string') {
        try {
          const parsed = JSON.parse(maybe);
          return unwrapDeep(parsed);
        } catch {
          return maybe;
        }
      }
      return unwrapDeep(maybe);
    } catch {
      return val;
    }
  }
  // 2) JSON-рядок -> об'єкт/значення
  if (typeof val === 'string') {
    const s = val.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        return unwrapDeep(JSON.parse(s));
      } catch {
        return s;
      }
    }
    return s;
  }
  return val;
}

function normalizeItem(raw: any): Campaign {
  // id може бути number|string|{value}|JSON
  let id = unwrapDeep(raw?.id ?? raw?._id ?? '');
  if (typeof id !== 'string') id = String(id ?? '');

  // назва з різних місць
  let name = unwrapDeep(raw?.name ?? raw?.title ?? '');

  // базова інформація
  const baseRaw =
    raw?.base ??
    raw?.baseInfo ??
    {
      pipeline: raw?.basePipelineId ?? raw?.pipeline,
      status: raw?.baseStatusId ?? raw?.status,
      pipelineName: raw?.basePipelineName ?? raw?.pipelineName,
      statusName: raw?.baseStatusName ?? raw?.statusName,
    };

  const base = {
    pipeline: unwrapDeep(baseRaw?.pipeline),
    status: unwrapDeep(baseRaw?.status),
    pipelineName: unwrapDeep(baseRaw?.pipelineName),
    statusName: unwrapDeep(baseRaw?.statusName),
  };

  // правила (v1/v2) — теж розпаковуємо
  const v1 = unwrapDeep(raw?.v1 ?? raw?.ruleV1 ?? '');
  const v2 = unwrapDeep(raw?.v2 ?? raw?.ruleV2 ?? '');

  // лічильники
  const counters: Counters = {
    v1: Number(unwrapDeep(raw?.counters?.v1) ?? 0) || 0,
    v2: Number(unwrapDeep(raw?.counters?.v2) ?? 0) || 0,
    exp: Number(unwrapDeep(raw?.counters?.exp) ?? 0) || 0,
  };

  return { id, name, base, v1, v2, counters };
}

export default function ClientList() {
  const [data, setData] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json: ApiList = await res.json();
        const items = (json.items ?? []).map(normalizeItem);
        if (!cancelled) setData(items);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
          Завантаження…
        </td>
      </tr>
    );
  }

  if (!data.length) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
          Кампаній поки немає
        </td>
      </tr>
    );
  }

  return (
    <>
      {data.map((item) => {
        const pipelineName =
          item.base?.pipelineName || item.base?.pipeline || '—';
        const statusName = item.base?.statusName || item.base?.status || '—';

        return (
          <tr key={item.id} className="border-b last:border-0">
            {/* Дата/ID */}
            <td className="whitespace-nowrap px-4 py-3 text-slate-600">
              <div>—</div>
              <div className="text-xs">ID: {item.id || '—'}</div>
            </td>

            {/* Назва */}
            <td className="px-4 py-3">{item.name || '—'}</td>

            {/* Сутність */}
            <td className="px-4 py-3">
              v1: {item.v1 ? String(item.v1) : '—'} · v2: {item.v2 ? String(item.v2) : '—'}
            </td>

            {/* Воронка */}
            <td className="px-4 py-3">
              {pipelineName} {statusName !== '—' ? `• ${statusName}` : ''}
            </td>

            {/* Лічильник */}
            <td className="px-4 py-3">
              v1: {item.counters?.v1 ?? 0} · v2: {item.counters?.v2 ?? 0} · exp:{' '}
              {item.counters?.exp ?? 0}
            </td>

            {/* Дії */}
            <td className="px-4 py-3">
              <form method="post" action="/api/campaigns/delete">
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
    </>
  );
}
