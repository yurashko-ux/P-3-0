// web/app/(admin)/admin/campaigns/page.tsx
export const dynamic = 'force-dynamic'; // без кешу/SSG

import Link from 'next/link';
import { headers } from 'next/headers';

/** Якщо хочеш читати дані безпосередньо з вашого store
 *  (і у тебе є lib/store.ts), підключай store тут та забирай
 *  fetch до API. Тоді прочитаєш KV безпосередньо.
 *
 *  import { store } from '../../../../lib/store';
 */

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = {
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

/** універсальний «розпакувальник» кривих значень:
 *  - {value: "..."} → ...
 *  - JSON-рядок → об’єкт/рядок
 *  - вкладені value → розпаковує рекурсивно
 */
function unwrapDeep(input: any): any {
  if (input == null) return input;
  let v = input;

  // розпаковуємо обгортку { value: ... }
  if (typeof v === 'object' && 'value' in (v as any)) v = (v as any).value;

  // якщо це JSON-рядок — пробуємо розпарсити
  if (typeof v === 'string') {
    const s = v.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        v = JSON.parse(s);
      } catch {
        // лишаємо як є
      }
    }
  }

  // рекурсивно проходимось по об’єктах/масивах
  if (Array.isArray(v)) return v.map(unwrapDeep);
  if (typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = unwrapDeep(val);
    return out;
  }
  return v;
}

/** Нормалізує одну кампанію (прибирає «обгортки») */
function normalize(raw: any): Campaign {
  const obj = unwrapDeep(raw) ?? {};
  return {
    id: String(obj.id ?? obj._id ?? ''),
    name: obj.name ?? '—',
    v1: obj.v1 ?? '—',
    v2: obj.v2 ?? '—',
    base: {
      pipeline: obj.base?.pipeline ?? undefined,
      status: obj.base?.status ?? undefined,
      pipelineName: obj.base?.pipelineName ?? '—',
      statusName: obj.base?.statusName ?? '—',
    },
    counters: {
      v1: Number(obj.counters?.v1 ?? 0),
      v2: Number(obj.counters?.v2 ?? 0),
      exp: Number(obj.counters?.exp ?? 0),
    },
    deleted: Boolean(obj.deleted ?? false),
    createdAt: Number(obj.createdAt ?? 0),
  };
}

/** Сторінка: читаємо дані або через API (no-store), або прямо зі store */
export default async function Page() {
  const h = headers();
  const urlOrigin = h.get('x-forwarded-proto') && h.get('x-forwarded-host')
    ? `${h.get('x-forwarded-proto')}://${h.get('x-forwarded-host')}`
    : '';

  // ВАРІАНТ 1 — читаємо через API (не кешуємо)
  const res = await fetch(`${urlOrigin}/api/campaigns`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({ ok: false, items: [] }));
  const items: Campaign[] = Array.isArray(data?.items)
    ? data.items.map(normalize).filter((x: Campaign) => !x.deleted)
    : [];

  // ВАРІАНТ 2 (якщо хочеш без API): зніми коментарі і підключи store вище
  // const raw = await store.getAll();
  // const items: Campaign[] = raw.filter(x => !x.deleted).map(normalize);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <div className="flex gap-3">
          <Link
            href="/admin/campaigns/new"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            + Нова кампанія
          </Link>
          <Link
            href="/admin/campaigns"
            className="rounded border px-4 py-2 hover:bg-gray-50"
          >
            Оновити
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="min-w-full table-fixed">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Дата/ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Назва</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Сутність</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Воронка</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Лічильник</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Дії</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                  Кампаній поки немає
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 align-top">
                    <div className="text-gray-900">—</div>
                    <div className="text-xs text-gray-500">ID: {it.id}</div>
                  </td>

                  <td className="px-4 py-3 align-top">{it.name ?? '—'}</td>

                  <td className="px-4 py-3 align-top">
                    <span>v1: {it.v1 ?? '—'}</span>
                    <span> · v2: {it.v2 ?? '—'}</span>
                  </td>

                  <td className="px-4 py-3 align-top">
                    {it.base?.pipelineName ?? '—'}{it.base?.statusName ? ` — ${it.base.statusName}` : ''}
                  </td>

                  <td className="px-4 py-3 align-top">
                    v1: {it.counters?.v1 ?? 0} · v2: {it.counters?.v2 ?? 0} · exp: {it.counters?.exp ?? 0}
                  </td>

                  <td className="px-4 py-3 align-top text-right">
                    <form action="/api/campaigns/delete" method="post">
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
