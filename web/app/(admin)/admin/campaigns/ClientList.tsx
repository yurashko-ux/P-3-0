'use client';

import { useEffect, useMemo, useState } from 'react';

/* ==== типи =============================================== */
type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Campaign = {
  id: string;
  name?: string;
  v1?: { value?: string };
  v2?: { value?: string };
  base?: BaseInfo;
  counters?: Counters;
  createdAt?: string | number | Date;
  deleted?: boolean;
};
type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

/* ==== утиліти ============================================ */
function fmtDate(d?: string | number | Date) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    return (
      dt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) +
      ' ' +
      dt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return '—';
  }
}
const dash = (v?: string | number | null) => (v ?? v === 0 ? String(v) : '—');

/** Рекурсивно «розпаковує» значення типу { value: ... } */
function unwrap<T = any>(input: any): T {
  let cur = input;
  // інколи приходять рядки з "[object Object]" — спробуємо розпарсити якщо виглядає як JSON
  if (typeof cur === 'string') {
    const s = cur.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        cur = JSON.parse(s);
      } catch {
        return input as T;
      }
    }
  }
  // розпаковуємо «цибулю» з value
  let guard = 0;
  while (cur && typeof cur === 'object' && 'value' in cur && guard < 10) {
    cur = (cur as any).value;
    guard++;
  }
  return cur as T;
}

/** Нормалізує одну кампанію: id/v1/v2/base -> чисті значення */
function normalizeItem(raw: any): Campaign {
  const id = String(unwrap(raw?.id ?? raw?._id ?? ''));
  const v1 = unwrap<string>(raw?.v1?.value ?? raw?.v1) || undefined;
  const v2 = unwrap<string>(raw?.v2?.value ?? raw?.v2) || undefined;

  // назви воронки/статусу (можуть приходити як id або object)
  const base = raw?.base ?? {};
  const pipeline =
    unwrap<string>(base?.pipelineName ?? base?.pipeline?.name ?? base?.pipeline) || undefined;
  const status =
    unwrap<string>(base?.statusName ?? base?.status?.name ?? base?.status) || undefined;

  return {
    id,
    name: unwrap<string>(raw?.name) || undefined,
    v1: { value: v1 },
    v2: { value: v2 },
    base: {
      pipeline,
      status,
      pipelineName: pipeline,
      statusName: status,
    },
    counters: {
      v1: Number(unwrap(raw?.counters?.v1 ?? 0)) || 0,
      v2: Number(unwrap(raw?.counters?.v2 ?? 0)) || 0,
      exp: Number(unwrap(raw?.counters?.exp ?? 0)) || 0,
    },
    createdAt: unwrap(raw?.createdAt) ?? undefined,
    deleted: Boolean(raw?.deleted),
  };
}

/** Нормалізує відповідь API */
function normalizeList(res: ApiList | any): ApiList {
  if (!res || typeof res !== 'object') return { ok: false, items: [], count: 0 };
  const items = Array.isArray(res.items) ? res.items.map(normalizeItem) : [];
  return { ok: Boolean(res.ok ?? true), items, count: Number(res.count ?? items.length) };
}

/* ==== КОМПОНЕНТ ========================================== */
export default function ClientList({ initial }: { initial?: ApiList }) {
  const [data, setData] = useState<ApiList>(() => normalizeList(initial ?? { ok: true, items: [] }));
  const [loading, setLoading] = useState<boolean>(
    !initial || typeof initial?.count === 'undefined'
  );

  // завжди тягнемо свіже з API після монтування
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/campaigns', { cache: 'no-store' });
        const json = await res.json();
        const normalized = normalizeList(json);
        if (!cancelled && normalized?.ok) setData(normalized);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => data.items ?? [], [data]);

  return (
    <div className="w-full">
      {/* Заголовок + кнопки */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-500">
          Всього: <span className="font-medium">{data.count ?? items.length ?? 0}</span>
        </div>
        <div className="flex gap-2">
          <a
            href="/admin/campaigns/new"
            className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            + Нова кампанія
          </a>
          <button
            onClick={() => {
              setLoading(true);
              fetch('/api/campaigns', { cache: 'no-store' })
                .then((r) => r.json())
                .then((j) => normalizeList(j))
                .then((norm) => setData(norm))
                .finally(() => setLoading(false));
            }}
            className="px-3 py-2 rounded-md border border-gray-300 hover:bg-gray-50"
          >
            Оновити
          </button>
        </div>
      </div>

      {/* Таблиця */}
      <div className="w-full overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-3 py-2 text-left">Дата/ID</th>
              <th className="px-3 py-2 text-left">Назва</th>
              <th className="px-3 py-2 text-left">Сутність</th>
              <th className="px-3 py-2 text-left">Воронка</th>
              <th className="px-3 py-2 text-left">Лічильник</th>
              <th className="px-3 py-2 text-left">Дії</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  Завантаження…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  Кампаній поки немає
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="text-gray-900">{fmtDate(c.createdAt)}</div>
                    <div className="text-gray-500 text-xs">ID: {dash(c.id)}</div>
                  </td>
                  <td className="px-3 py-2">{dash(c.name)}</td>
                  <td className="px-3 py-2">
                    v1: {dash(c?.v1?.value)} · v2: {dash(c?.v2?.value)}
                  </td>
                  <td className="px-3 py-2">
                    {dash(c?.base?.pipelineName ?? c?.base?.pipeline)} ·{' '}
                    {dash(c?.base?.statusName ?? c?.base?.status)}
                  </td>
                  <td className="px-3 py-2">
                    v1: {dash(c?.counters?.v1 ?? 0)} · v2: {dash(c?.counters?.v2 ?? 0)} · exp:{' '}
                    {dash(c?.counters?.exp ?? 0)}
                  </td>
                  <td className="px-3 py-2">
                    <form
                      action={`/admin/campaigns/delete?id=${encodeURIComponent(c.id)}`}
                      method="post"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        fetch(form.action, { method: 'POST' })
                          .then(() => fetch('/api/campaigns', { cache: 'no-store' }))
                          .then((r) => r.json())
                          .then((j) => setData(normalizeList(j)))
                          .catch(() => {});
                      }}
                    >
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-md bg-red-500 text-white hover:bg-red-600"
                      >
                        Видалити
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
