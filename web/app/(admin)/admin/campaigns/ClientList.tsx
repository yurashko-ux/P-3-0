'use client';

import { useEffect, useMemo, useState } from 'react';

/* ========= Типи ========= */
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
};

export type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

/* ========= Хелпери ========= */

/** Дістає значення з вкладених { value: ... } або JSON-рядків */
function unwrapDeep<T = any>(input: any): T {
  let val = input;
  try {
    // JSON у JSON (з кей-велью можуть бути рядки-об’єкти)
    if (typeof val === 'string' && (val.includes('{') || val.includes('['))) {
      val = JSON.parse(val);
    }
  } catch {
    /* ignore */
  }
  // unwrap { value: ... }
  if (val && typeof val === 'object' && 'value' in val) {
    return unwrapDeep((val as any).value);
  }
  return val as T;
}

/** Нормалізує «сиру» кампанію з KV/індексу до плоского вигляду */
function normalizeItem(raw: any): Campaign {
  // id може бути number | string | {value} | JSON-рядок
  let id = unwrapDeep<string | number>(raw?.id ?? raw?._id ?? '');
  if (typeof id !== 'string') id = String(id ?? '');

  const v1 = unwrapDeep<string>(raw?.v1 ?? '');
  const v2 = unwrapDeep<string>(raw?.v2 ?? '');
  const name = unwrapDeep<string>(raw?.name ?? '');

  const base: BaseInfo = {
    pipeline: unwrapDeep<string>(raw?.base?.pipeline ?? raw?.pipeline ?? ''),
    status: unwrapDeep<string>(raw?.base?.status ?? raw?.status ?? ''),
    pipelineName: unwrapDeep<string>(raw?.base?.pipelineName ?? ''),
    statusName: unwrapDeep<string>(raw?.base?.statusName ?? ''),
  };

  const counters: Counters = {
    v1: Number(unwrapDeep<number>(raw?.counters?.v1 ?? 0)) || 0,
    v2: Number(unwrapDeep<number>(raw?.counters?.v2 ?? 0)) || 0,
    exp: Number(unwrapDeep<number>(raw?.counters?.exp ?? 0)) || 0,
  };

  return { id, name, v1, v2, base, counters, deleted: !!raw?.deleted };
}

/* ========= Компонент списку ========= */

type Props = { initial: ApiList };

/**
 * Рендерить <tbody> зі списком кампаній.
 * Очікується, що таблиця та <thead> лежать у батьківському компоненті/сторінці.
 */
export default function ClientList({ initial }: Props) {
  const [items, setItems] = useState<Campaign[]>(
    (initial?.items ?? []).map(normalizeItem)
  );
  const [loading, setLoading] = useState(false);

  // Робимо фетч при маунті, щоб підхопити актуальні дані
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const data: ApiList = await res.json();
        if (!cancelled && data?.ok) {
          setItems((data.items ?? []).map(normalizeItem));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const empty = !items?.length;

  async function handleDelete(id: string) {
    if (!id) return;
    // м’яка підстраховка: підтвердження
    const yes = confirm('Видалити кампанію? Це дію не можна скасувати.');
    if (!yes) return;

    try {
      setLoading(true);

      // 1) пробуємо DELETE API
      const del = await fetch(`/api/campaigns?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      // 2) якщо бек не підтримує DELETE — fallback на сторінковий роут
      if (!del.ok) {
        await fetch(`/admin/campaigns/delete?id=${encodeURIComponent(id)}`, {
          method: 'GET',
          cache: 'no-store',
        });
      }

      // локально прибираємо запис
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    if (empty) {
      return (
        <tr>
          <td colSpan={6} className="text-center text-gray-500 py-8">
            Кампаній поки немає
          </td>
        </tr>
      );
    }

    return items.map((it) => {
      const idText = it.id || '—';
      const nameText = it.name || '—';
      const vText = `v1: ${it.v1 || '—'} · v2: ${it.v2 || '—'}`;

      // Якщо немає назв воронки/статусу — друкуємо «#—»
      const pipe =
        it.base?.pipelineName ||
        it.base?.pipeline ||
        '#—';
      const counters = `v1: ${it.counters?.v1 ?? 0} · v2: ${it.counters?.v2 ?? 0} · exp: ${
        it.counters?.exp ?? 0
      }`;

      return (
        <tr key={it.id} className="border-b last:border-0">
          <td className="align-top py-3">
            <div>—</div>
            <div className="text-gray-500 text-sm">ID: {idText}</div>
          </td>
          <td className="align-top py-3">{nameText}</td>
          <td className="align-top py-3">{vText}</td>
          <td className="align-top py-3">{pipe}</td>
          <td className="align-top py-3">{counters}</td>
          <td className="align-top py-3">
            <button
              onClick={() => handleDelete(it.id)}
              disabled={loading}
              className="rounded-md bg-red-500 px-3 py-1.5 text-white hover:bg-red-600 disabled:opacity-50"
            >
              Видалити
            </button>
          </td>
        </tr>
      );
    });
  }, [items, empty, loading]);

  return <tbody>{rows}</tbody>;
}
