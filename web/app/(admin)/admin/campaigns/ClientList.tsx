'use client';

import { useEffect, useMemo, useState } from 'react';

type Campaign = {
  id: string;
  name?: string;
  v1?: { value?: string };
  v2?: { value?: string };
  base?: { pipeline?: string; status?: string };
  counters?: { v1?: number; v2?: number; exp?: number };
  createdAt?: string | number | Date;
  deleted?: boolean;
};

type ApiList = { ok: boolean; items?: Campaign[]; count?: number };

/** Розплутуємо будь-які «дивні» значення id з KV:
 * "1759...", {"value":"1759..."}, "{\"value\":\"1759...\"}", і навіть вкладені кілька разів. */
function normalizeId(raw: unknown): string {
  let cur: unknown = raw;

  // розмотуємо 3 кола: достатньо для наших кейсів
  for (let i = 0; i < 3; i++) {
    // якщо строка схожа на JSON — парсимо
    if (typeof cur === 'string') {
      const s = cur.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
        try {
          cur = JSON.parse(s);
          continue;
        } catch {
          // не JSON — повертаємо як є
          return s;
        }
      }
      return s;
    }

    // якщо обʼєкт виду { value: ... } — беремо value
    if (cur && typeof cur === 'object' && 'value' in (cur as any)) {
      // @ts-ignore
      cur = (cur as any).value;
      continue;
    }

    break;
  }

  if (typeof cur === 'string') return cur;
  return String(cur ?? '');
}

function fmtDate(x?: string | number | Date) {
  if (!x) return '—';
  try {
    const d = new Date(x);
    if (Number.isNaN(+d)) return '—';
    return d.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function ClientList() {
  const [data, setData] = useState<ApiList>({ ok: true, items: [], count: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const json = (await res.json()) as ApiList;
      // підчищаємо id одразу
      const items = (json.items ?? []).map((c) => ({ ...c, id: normalizeId(c.id) }));
      setData({ ok: json.ok, items, count: json.count ?? items.length });
    } catch (e: any) {
      setErr(e?.message || 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const items = useMemo(() => data.items ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Всього: <span className="font-semibold">{data.count ?? items.length}</span>
        </div>
        <button
          onClick={load}
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 active:scale-[0.99]"
          disabled={loading}
        >
          {loading ? 'Оновлюю…' : 'Оновити'}
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 rounded-xl border">
          <thead>
            <tr className="bg-gray-50 text-left text-sm font-medium text-gray-600">
              <th className="sticky top-0 z-10 border-b px-4 py-3">Дата/ID</th>
              <th className="sticky top-0 z-10 border-b px-4 py-3">Назва</th>
              <th className="sticky top-0 z-10 border-b px-4 py-3">Сутність</th>
              <th className="sticky top-0 z-10 border-b px-4 py-3">Воронка</th>
              <th className="sticky top-0 z-10 border-b px-4 py-3">Лічильник</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500" colSpan={5}>
                  Кампаній поки немає
                </td>
              </tr>
            )}

            {items.map((c) => {
              const id = normalizeId(c.id);
              const datePart = fmtDate(c.createdAt);
              const name = c.name || '—';
              const essence =
                (c.v1?.value ? `v1: ${c.v1.value}` : 'v1: —') +
                ' · ' +
                (c.v2?.value ? `v2: ${c.v2.value}` : 'v2: —');
              const funnel =
                (c.base?.pipeline ? `#${c.base.pipeline}` : '#—') +
                (c.base?.status ? `, cтaтус: ${c.base.status}` : '');
              const counter =
                `v1: ${c.counters?.v1 ?? 0} · v2: ${c.counters?.v2 ?? 0} · exp: ${c.counters?.exp ?? 0}`;

              return (
                <tr key={`${id}-${name}`} className="border-t align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <div className="text-gray-700">{datePart}</div>
                    <div className="text-xs text-gray-400">ID: {id || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{essence}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{funnel}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{counter}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
