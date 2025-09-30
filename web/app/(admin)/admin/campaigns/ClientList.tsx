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

/** Розплутуємо «дивні» значення id з KV */
function normalizeId(raw: unknown): string {
  let cur: unknown = raw;

  for (let i = 0; i < 3; i++) {
    if (typeof cur === 'string') {
      const s = cur.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
        try {
          cur = JSON.parse(s);
          continue;
        } catch {
          return s;
        }
      }
      return s;
    }
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const json = (await res.json()) as ApiList;
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

  async function handleDelete(id: string) {
    if (!id) return;
    if (!confirm('Видалити кампанію?')) return;

    const prev = items;
    setBusyId(id);
    setData((d) => ({ ...d, items: (d.items ?? []).filter((x) => x.id !== id), count: (d.count ?? prev.length) - 1 }));

    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.reason || `Помилка видалення (${res.status})`);
      }
      setInfo('Кампанію видалено.');
      setTimeout(() => setInfo(null), 2500);
    } catch (e: any) {
      // rollback
      setData((d) => ({ ...d, items: prev, count: prev.length }));
      alert(e?.message || 'Не вдалося видалити');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Всього: <span className="font-semibold">{data.count ?? items.length}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 active:scale-[0.99]"
            disabled={loading}
          >
            {loading ? 'Оновлюю…' : 'Оновити'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
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
              <th className="sticky top-0 z-10 border-b px-4 py-3">Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
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
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => handleDelete(id)}
                      disabled={busyId === id}
                      className={`rounded-md px-3 py-1.5 text-sm text-white ${
                        busyId === id ? 'bg-red-300' : 'bg-red-500 hover:bg-red-600'
                      }`}
                      title="Видалити кампанію"
                    >
                      {busyId === id ? 'Видаляю…' : 'Видалити'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
