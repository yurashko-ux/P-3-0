'use client';

import { useEffect, useState } from 'react';

/** Публічні типи, щоб не конфліктувати з сторінкою */
export type Counters = { v1?: number; v2?: number; exp?: number };
export type BaseInfo = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
export type Campaign = {
  id: string | number | { value?: any } | any;
  name?: string;
  v1?: string;
  v2?: string;
  base?: BaseInfo | string | any;
  counters?: Counters | string | any;
  deleted?: boolean;
};
export type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

/** Безпечне витягування вкладених value / JSON-рядків */
function unwrapDeep(input: any): any {
  let v = input;
  try {
    // якщо формат {"value": "..."} або глибше — витягуємо
    while (v && typeof v === 'object' && 'value' in v) v = v.value;
    // якщо це JSON-рядок — парсимо
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
      const parsed = JSON.parse(v);
      return unwrapDeep(parsed);
    }
  } catch {
    // ігноруємо — повернемо як є
  }
  return v;
}

/** Нормалізація одного елемента у більш передбачуваний вигляд */
function normalizeItem(raw: any) {
  const idRaw = raw?.id ?? raw?._id ?? '';
  let id = unwrapDeep(idRaw);
  if (id && typeof id === 'object' && 'value' in id) id = unwrapDeep(id.value);

  const name = (() => {
    const n = unwrapDeep(raw?.name);
    return typeof n === 'string' && n.trim() ? n.trim() : '—';
  })();

  const v1 = (() => {
    const val = unwrapDeep(raw?.v1);
    return typeof val === 'string' && val.trim() ? val.trim() : '—';
  })();

  const v2 = (() => {
    const val = unwrapDeep(raw?.v2);
    return typeof val === 'string' && val.trim() ? val.trim() : '—';
  })();

  const baseRaw = unwrapDeep(raw?.base);
  const base: BaseInfo = {
    pipeline: unwrapDeep(baseRaw?.pipeline) ?? undefined,
    status: unwrapDeep(baseRaw?.status) ?? undefined,
    pipelineName: unwrapDeep(baseRaw?.pipelineName) ?? undefined,
    statusName: unwrapDeep(baseRaw?.statusName) ?? undefined,
  };

  const countersRaw = unwrapDeep(raw?.counters);
  const counters: Counters = {
    v1: Number(unwrapDeep(countersRaw?.v1) ?? 0) || 0,
    v2: Number(unwrapDeep(countersRaw?.v2) ?? 0) || 0,
    exp: Number(unwrapDeep(countersRaw?.exp) ?? 0) || 0,
  };

  return { id, name, v1, v2, base, counters, deleted: !!raw?.deleted } as Campaign & {
    base: BaseInfo;
    counters: Counters;
  };
}

/** Рядок таблиці з однією кампанією */
function Row({ item }: { item: ReturnType<typeof normalizeItem> }) {
  const { id, name, v1, v2, base, counters, deleted } = item;

  const idDisplay =
    typeof id === 'string' || typeof id === 'number'
      ? String(id)
      : '[object Object]';

  const pipelineLabel =
    base?.pipelineName || base?.pipeline || '—';
  const statusLabel =
    base?.statusName || base?.status || '—';

  return (
    <tr className="border-b border-slate-200">
      <td className="px-4 py-3 text-sm text-slate-700">
        <div className="flex flex-col">
          <span className="text-slate-900">—</span>
          <span className="text-slate-500 text-xs">ID: {idDisplay}</span>
        </div>
      </td>

      <td className="px-4 py-3 text-sm text-slate-700">
        {name || '—'}
      </td>

      <td className="px-4 py-3 text-sm text-slate-700">
        v1: {v1} · v2: {v2}
      </td>

      <td className="px-4 py-3 text-sm text-slate-700">
        {pipelineLabel} {statusLabel !== '—' ? `· ${statusLabel}` : ''}
      </td>

      <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
        v1: {counters.v1} · v2: {counters.v2} · exp: {counters.exp}
      </td>

      <td className="px-4 py-3 text-right">
        {deleted ? (
          <span className="text-xs text-slate-400">видалено</span>
        ) : (
          <form
            action={`/api/campaigns/delete?id=${encodeURIComponent(
              typeof id === 'string' || typeof id === 'number' ? String(id) : ''
            )}`}
            method="POST"
          >
            <button
              type="submit"
              className="rounded-md bg-red-600 px-3 py-1.5 text-white text-sm hover:bg-red-700"
              aria-label="Видалити"
            >
              Видалити
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

/** Клієнтський список: тягне /api/campaigns та показує нормалізовані дані */
export default function ClientList({ initial }: { initial: ApiList }) {
  const [data, setData] = useState<ApiList>(initial);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json: ApiList = await res.json();
        if (!ignore && json?.ok) setData(json);
      } catch {
        // ігноруємо
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const items = (data?.items ?? []).map(normalizeItem);

  if (!items.length) {
    return (
      <tbody>
        <tr>
          <td
            className="px-4 py-12 text-center text-slate-500"
            colSpan={6}
          >
            Кампаній поки немає
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {items.map((it, i) => (
        <Row key={`${it.id}-${i}`} item={it} />
      ))}
    </tbody>
  );
}
