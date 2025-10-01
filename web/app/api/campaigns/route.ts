// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';

type Counters = { v1?: number; v2?: number; exp?: number };
type BaseInfo = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Campaign = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: BaseInfo;
  counters?: Counters;
};

const URL_RO = process.env.KV_REST_API_URL!;
const TOKEN_RO = process.env.KV_REST_API_READ_ONLY_TOKEN!;
const URL_WR = process.env.KV_REST_API_URL!;
const TOKEN_WR = process.env.KV_REST_API_TOKEN!;

const INDEX_KEY = 'cmp:index';           // список id (LRANGE 0 -1)
const ITEM_KEY = (id: string) => `cmp:${id}`; // сама кампанія як JSON

/** універсальний розпаковувач value/JSON */
function unwrapDeep<T = any>(v: any): T {
  if (v == null) return v;
  let cur = v;
  while (cur && typeof cur === 'object' && 'value' in cur) cur = (cur as any).value;
  if (typeof cur === 'string') {
    const s = cur.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return JSON.parse(s); } catch {}
    }
  }
  return cur as T;
}

/** простий виклик Upstash REST (single command) */
async function upstash(cmd: string, args: (string | number)[], token: string) {
  const res = await fetch(`${URL_RO}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([[cmd, ...args].map(String)]),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  const json = await res.json(); // [{ result: ... }]
  return json?.[0]?.result;
}

/** читаємо всі кампанії */
async function loadAll(): Promise<Campaign[]> {
  // 1) беремо список id
  const ids = (await upstash('LRANGE', [INDEX_KEY, 0, -1], TOKEN_RO)) as string[] | null;
  if (!ids || ids.length === 0) return [];

  // 2) батчем MGET усіх айтемів
  const keys = ids.map(ITEM_KEY);
  const rows = (await upstash('MGET', keys, TOKEN_RO)) as (string | null)[] | null;
  if (!rows) return [];

  // 3) нормалізуємо
  const items: Campaign[] = rows
    .map((raw, i) => {
      const parsed = unwrapDeep<any>(raw ?? '{}') || {};
      // підстрахуємо id з індексу
      parsed.id = parsed.id ?? ids[i];

      const id = String(unwrapDeep(parsed.id ?? ''));
      const name = unwrapDeep<string>(parsed.name ?? '');
      const v1 = unwrapDeep<string>(parsed.v1 ?? '');
      const v2 = unwrapDeep<string>(parsed.v2 ?? '');

      const baseRaw = unwrapDeep<any>(parsed.base ?? {});
      const base: BaseInfo = {
        pipeline: unwrapDeep<string>(baseRaw?.pipeline ?? ''),
        status: unwrapDeep<string>(baseRaw?.status ?? ''),
        pipelineName: unwrapDeep<string>(baseRaw?.pipelineName ?? ''),
        statusName: unwrapDeep<string>(baseRaw?.statusName ?? ''),
      };

      const cRaw = unwrapDeep<any>(parsed.counters ?? {});
      const counters: Counters = {
        v1: Number(unwrapDeep(cRaw?.v1 ?? 0) || 0),
        v2: Number(unwrapDeep(cRaw?.v2 ?? 0) || 0),
        exp: Number(unwrapDeep(cRaw?.exp ?? 0) || 0),
      };

      return { id, name, v1, v2, base, counters };
    })
    .filter(Boolean);

  return items;
}

/** простий сидер однієї тест-кампанії */
async function seedOne(): Promise<Campaign> {
  const id = String(Date.now());
  const item: Campaign = {
    id,
    name: 'UI-created',
    v1: '',
    v2: '',
    base: { pipeline: '', status: '', pipelineName: '', statusName: '' },
    counters: { v1: 0, v2: 0, exp: 0 },
  };
  // LPUSH id в індекс
  await upstash('LPUSH', [INDEX_KEY, id], TOKEN_WR);
  // SET JSON об’єкта
  await upstash('SET', [ITEM_KEY(id), JSON.stringify(item)], TOKEN_WR);
  return item;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('seed') === '1') {
      // швидкий сид для перевірки UI
      await seedOne();
    }
    const items = await loadAll();
    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (e) {
    console.error('GET /api/campaigns failed', e);
    return NextResponse.json({ ok: false, items: [], count: 0 }, { status: 500 });
  }
}
