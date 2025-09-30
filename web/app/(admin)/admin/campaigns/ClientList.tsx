'use client';

import { useEffect, useMemo, useState } from 'react';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};
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

function dash(v?: string | number | null) {
  if (v == null || v === '' || v === 'null' || v === 'undefined') return '—';
  return String(v);
}

function fmtRules(c?: Campaign) {
  const v1 = c?.v1?.value ?? '';
  const v2 = c?.v2?.value ?? '';
  return `v1: ${dash(v1)} · v2: ${dash(v2)}`;
}

function fmtFunnel(c?: Campaign) {
  const p = c?.base?.pipelineName || c?.base?.pipeline || '';
  const s = c?.base?.statusName || c?.base?.status || '';
  if (!p && !s) return '—';
  if (p && s) return `${p} → ${s}`;
  return p || s || '—';
}

function fmtCounters(c?: Campaign) {
  const cv1 = c?.counters?.v1 ?? 0;
  const cv2 = c?.counters?.v2 ?? 0;
  const exp = c?.counters?.exp ?? 0;
  return `v1: ${cv1} • v2: ${cv2} • exp: ${exp}`;
}

async function fetchDetails(id: string): Promise<Campaign | null> {
  try {
    const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.ok && j?.item) return j.item as Campaign;
    return null;
  } catch {
    return null;
  }
}

export default function ClientList({ initial }: { initial: ApiList }) {
  // локальний список, який збагачуємо деталями
  const [rows, setRows] = useState<Campaign[]>(
    () => (initial.items ?? []).map((x) => ({ ...x }))
  );
  const count = useMemo(() => initial.count ?? rows.length, [initial.count, rows.length]);

  // підтягнути деталі для кожного id паралельно
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = (rows ?? [])
        .map((r) => r?.id)
        .filter((x): x is string => typeof x === 'string' && x.length > 0);

      if (ids.length === 0) return;

      const settled = await Promise.allSettled(ids.map((id) => fetchDetails(id)));
      if (cancelled) return;

      const byId = new Map<string, Campaign>();
      settled.forEach((res, i) => {
        const id = ids[i];
        if (res.status === 'fulfilled' && res.value) {
          byId.set(id, res.value);
        }
      });

      if (byId.size === 0) return;

      setRows((prev) =>
        prev.map((r) => {
          const m = byId.get(r.id);
          return m ? { ...r, ...m } : r;
        })
      );
    })();

    return () => {
      cancelled = true;
    };
    // тільки при першому маунті — rows береться зі стартового стану
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm('Видалити кампанію?')) return;
    try {
      const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      // оптимістично прибираємо рядок
      setRows((prev) => prev.filter((x) => x.id !== id));
    } catch {
      alert('Не вдалося видалити. Спробуйте ще раз.');
    }
  };

  return (
    <div className="w-full">
      <div className="text-sm text-gray-500 mb-3">Всього: {count}</div>

      <div className="overflow-x-auto rounded-xl border border-black/5">
        <table className="min-w-full text-[14px]">
          <thead>
            <tr className="bg-black/5 text-gray-700">
              <th className="text-left px-4 py-3 w-[240px]">Дата/ID</th>
              <th className="text-left px-4 py-3 w-[220px]">Назва</th>
              <th className="text-left px-4 py-3 w-[280px]">Сутність</th>
              <th className="text-left px-4 py-3 w-[280px]">Воронка</th>
              <th className="text-left px-4 py-3 w-[220px]">Лічильник</th>
              <th className="text-left px-4 py-3 w-[140px]">Дії</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const created =
                c.createdAt ? new Date(c.createdAt).toLocaleString() : '—';
              return (
                <tr key={c.id} className="border-t border-black/5">
                  <td className="px-4 py-3 align-top">
                    <div className="text-gray-500">—</div>
                    <div className="text-gray-400 text-xs">ID: {dash(c.id)}</div>
                  </td>
                  <td className="px-4 py-3 align-top">{dash(c.name)}</td>
                  <td className="px-4 py-3 align-top">{fmtRules(c)}</td>
                  <td className="px-4 py-3 align-top">{fmtFunnel(c)}</td>
                  <td className="px-4 py-3 align-top">{fmtCounters(c)}</td>
                  <td className="px-4 py-3 align-top">
                    <button
                      onClick={() => onDelete(c.id)}
                      className="rounded-md bg-red-500 text-white px-3 py-1.5 hover:bg-red-600 transition"
                    >
                      Видалити
                    </button>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  Кампаній поки немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* При бажанні можна показати дату створення під таблицею */}
      {/* <div className="mt-2 text-xs text-gray-400">Оновлено: {new Date().toLocaleString()}</div> */}
    </div>
  );
}
