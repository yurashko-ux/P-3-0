// app/(admin)/admin/campaigns/ClientList.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

/** Типи, які використовує і сторінка, і цей компонент */
export type Campaign = {
  id: string;
  name?: string;
  base?: {
    pipelineId?: string;
    statusId?: string;
    pipelineName?: string;
    statusName?: string;
  };
  v1?: string;
  v2?: string;
  createdAt?: string | number | Date;

  // збагачені поля для відображення
  ui: {
    displayId: string;
    displayDate: string;
    displayName: string;
    displayBase: string; // "Воронка — Статус"
    displayEntity: string; // "v1: ... · v2: ..."
    displayCounters: string; // "v1: x · v2: y · exp: z"
  };
};

export type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

/** Невибагливе розпакування значення — працює з {value}, JSON-рядками та звичайними типами */
function unwrapDeep<T = any>(val: any): T {
  try {
    if (val == null) return val as T;
    if (typeof val === 'object' && 'value' in val) return unwrapDeep((val as any).value);
    if (typeof val === 'string') {
      const s = val.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        return unwrapDeep(JSON.parse(s));
      }
    }
    return val as T;
  } catch {
    return val as T;
  }
}

/** Добуває лічильник з кількох можливих полів */
function getCounter(raw: any, key: 'v1' | 'v2' | 'exp'): number {
  const r = unwrapDeep(raw);
  // можливі варіанти розташування
  const fromCounters = unwrapDeep(r?.counters)?.[key];
  if (typeof fromCounters === 'number') return fromCounters;

  const fromMetrics = unwrapDeep(r?.metrics)?.[key];
  if (typeof fromMetrics === 'number') return fromMetrics;

  const direct = r?.[`${key}_count`] ?? r?.[`${key}Count`] ?? r?.[key];
  if (typeof direct === 'number') return direct;

  // нічого не знайшли
  return 0;
}

/** Назва воронки / статусу з різних місць */
function resolveBase(raw: any): { pipelineName?: string; statusName?: string } {
  const base = unwrapDeep(raw?.base) ?? {};
  // найкращий варіант — уже підготовлені назви
  let pipelineName = unwrapDeep(base?.pipelineName);
  let statusName = unwrapDeep(base?.statusName);

  // іноді приходять тільки id — якщо є довідники у payload, спробуємо підставити
  if (!pipelineName) {
    const pid = unwrapDeep(base?.pipelineId);
    const dict = unwrapDeep(raw?.dictionaries?.pipelines) ?? unwrapDeep(raw?.meta?.pipelines);
    if (pid && dict && typeof dict === 'object' && dict[pid]) pipelineName = unwrapDeep(dict[pid]);
  }

  if (!statusName) {
    const sid = unwrapDeep(base?.statusId);
    const dict = unwrapDeep(raw?.dictionaries?.statuses) ?? unwrapDeep(raw?.meta?.statuses);
    if (sid && dict && typeof dict === 'object' && dict[sid]) statusName = unwrapDeep(dict[sid]);
  }

  return { pipelineName, statusName };
}

/** Нормалізує одну кампанію під наш UI */
function normalizeItem(raw: any): Campaign {
  // id може бути: число, рядок, {value}, або JSON
  let id = unwrapDeep(raw?.id ?? raw?._id ?? '');
  if (id && typeof id !== 'string') id = String(id);

  const name =
    unwrapDeep(raw?.name) ??
    unwrapDeep(raw?.title) ??
    ''; // якщо немає — покажемо "—" у відмальовці

  const v1 = unwrapDeep(raw?.v1) ?? '';
  const v2 = unwrapDeep(raw?.v2) ?? '';

  const createdAtRaw = unwrapDeep(raw?.createdAt ?? raw?.created_at ?? raw?.date);
  const createdAt =
    createdAtRaw ? new Date(createdAtRaw) : undefined;

  const { pipelineName, statusName } = resolveBase(raw);

  const cntV1 = getCounter(raw, 'v1');
  const cntV2 = getCounter(raw, 'v2');
  const cntExp = getCounter(raw, 'exp');

  const displayId = id || '—';
  const displayDate = createdAt ? createdAt.toLocaleDateString() : '—';
  const displayName = name || '—';
  const displayBase =
    pipelineName || statusName
      ? `${pipelineName ?? '#—'} — ${statusName ?? '#—'}`
      : '#—';
  const displayEntity = `v1: ${v1 || '—'} · v2: ${v2 || '—'}`;
  const displayCounters = `v1: ${cntV1} · v2: ${cntV2} · exp: ${cntExp}`;

  return {
    id,
    name,
    base: {
      pipelineName,
      statusName,
      pipelineId: unwrapDeep(raw?.base?.pipelineId),
      statusId: unwrapDeep(raw?.base?.statusId)
    },
    v1,
    v2,
    createdAt,
    ui: {
      displayId,
      displayDate,
      displayName,
      displayBase,
      displayEntity,
      displayCounters
    }
  };
}

/** Рядок таблиці */
function Row({ item, onDelete }: { item: Campaign; onDelete: (id: string) => void }) {
  return (
    <tr className="border-t">
      <td className="px-4 py-3">
        <div className="text-sm text-gray-900">—</div>
        <div className="text-xs text-gray-500">ID: {item.ui.displayId}</div>
      </td>

      <td className="px-4 py-3">{item.ui.displayName}</td>

      <td className="px-4 py-3">{item.ui.displayEntity}</td>

      <td className="px-4 py-3">{item.ui.displayBase}</td>

      <td className="px-4 py-3">{item.ui.displayCounters}</td>

      <td className="px-4 py-3">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const res = await fetch(`/admin/campaigns/delete?id=${encodeURIComponent(item.id)}`, {
                method: 'POST'
              });
              if (!res.ok) throw new Error('Delete failed');
              onDelete(item.id);
            } catch {
              // no-op
            }
          }}
        >
          <button className="rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">
            Видалити
          </button>
        </form>
      </td>
    </tr>
  );
}

/** Клієнтський список: робить запит та показує рядки */
export default function ClientList({ initial }: { initial: ApiList }) {
  const [data, setData] = useState<ApiList>(initial);

  // фетч актуальних даних
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json = await res.json();
        if (abort) return;
        if (json?.ok) {
          const items = Array.isArray(json.items) ? json.items.map(normalizeItem) : [];
          setData({ ok: true, items, count: json.count ?? items.length });
        } else {
          setData((prev) => ({
            ok: true,
            items: (prev.items ?? []).map(normalizeItem),
            count: prev.count ?? prev.items?.length ?? 0
          }));
        }
      } catch {
        // залишаємо initial, якщо не вдалось фетчнути
      }
    })();
    return () => {
      abort = true;
    };
  }, []);

  const items = useMemo(
    () => (Array.isArray(data.items) ? data.items : []).map(normalizeItem),
    [data.items]
  );

  if (!items.length) {
    return (
      <tbody>
        <tr>
          <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
            Кампаній поки немає
          </td>
        </tr>
      </tbody>
    );
  }

  const handleDelete = (id: string) => {
    setData((prev) => ({
      ok: true,
      items: (prev.items ?? []).filter((x) => x.id !== id),
      count: Math.max(0, (prev.count ?? 1) - 1)
    }));
  };

  return (
    <tbody>
      {items.map((item) => (
        <Row key={item.id} item={item} onDelete={handleDelete} />
      ))}
    </tbody>
  );
}
