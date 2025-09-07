// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Any = Record<string, any>;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

const NO_STORE = {
  headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
};

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

/* ------------------------------------------------------------------ helpers */

async function zrangeIds(): Promise<string[]> {
  return (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
}

// 1) Основний шлях: читаємо по індексу (ПОСЛІДОВНО, без mget)
async function loadByIndex(): Promise<Any[]> {
  const ids = await zrangeIds();
  if (!ids.length) return [];
  const items: Any[] = [];
  for (const id of ids) {
    const raw = await redis.get<string>(ITEM_KEY(id));
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj) items.push(obj);
    } catch {}
  }
  return items;
}

// 2) Повний скан ключів (fallback)
async function scanAll(match: string, count = 200): Promise<string[]> {
  let cursor = 0;
  const acc: string[] = [];
  while (true) {
    const res: any = await (redis as any).scan(cursor, { match, count });
    const next = Array.isArray(res) ? Number(res[0]) : Number(res?.cursor ?? 0);
    const keys = Array.isArray(res) ? (res[1] as string[]) : ((res?.keys as string[]) ?? []);
    if (keys?.length) acc.push(...keys);
    cursor = next;
    if (!cursor) break;
  }
  return acc;
}

function looksLikeDocKey(k: string) {
  if (k === INDEX_KEY) return false;
  if (k.startsWith('campaigns:__probe__')) return false;
  if (k.endsWith(':index')) return false;
  return k.startsWith('campaigns:');
}

// 2a) Читання всіх документів через SCAN (повний fallback)
async function loadByScan(): Promise<Any[]> {
  const keys = await scanAll('campaigns:*', 500);
  const docKeys = keys.filter(looksLikeDocKey);
  if (!docKeys.length) return [];
  const items: Any[] = [];
  for (const k of docKeys) {
    const raw = await redis.get<string>(k);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj) items.push(obj);
    } catch {}
  }
  // сортуємо новіші зверху
  items.sort((a, b) => Number(b?.created_at ?? 0) - Number(a?.created_at ?? 0));
  return items;
}

// Відбудова індексу з документів
async function healIndexFromDocs(): Promise<number> {
  const items = await loadByScan();
  let rebuilt = 0;
  for (const it of items) {
    const id = it?.id; if (!id) continue;
    const score = Number(it.created_at) || Date.now();
    await redis.zadd(INDEX_KEY, { score, member: String(id) });
    rebuilt++;
  }
  return rebuilt;
}

/* ---------------------------------------------------------------- handlers */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const act =
    url.searchParams.get('__act') ||
    url.searchParams.get('act') ||
    (url.searchParams.has('seed') ? 'seed'
      : url.searchParams.has('debug') ? 'debug'
      : url.searchParams.has('rebuild') ? 'rebuild'
      : '');

  // seed: створюємо одну валідну кампанію
  if (act === 'seed') {
    const now = Date.now();
    const id = 'SEED_' + genId();
    const item: Any = {
      id,
      name: 'SEED TEST ' + new Date(now).toISOString(),
      enabled: true,
      created_at: now,
      updated_at: now,
      base_pipeline_id: null,
      base_status_id: null,
      v1_field: 'text',
      v1_op: 'contains',
      v1_value: 'yes',
      v1_to_pipeline_id: null,
      v1_to_status_id: null,
    };
    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, { score: now, member: id });
    const ids = await zrangeIds();
    return NextResponse.json({ ok: true, created: id, indexCount: ids.length }, NO_STORE);
  }

  // debug: розширений стан KV / індексу
  if (act === 'debug') {
    const byIndex = await loadByIndex();
    const indexIds = await zrangeIds();
    const keys = await scanAll('campaigns:*', 500);
    // Перевіримо перші 3 id напряму — чи існують
    const peek: Record<string, boolean> = {};
    for (const id of indexIds.slice(0, 3)) {
      const raw = await redis.get<string>(ITEM_KEY(id));
      peek[id] = !!raw;
    }
    let sample: Any | null = null;
    if (indexIds[0]) {
      const raw = await redis.get<string>(ITEM_KEY(indexIds[0]));
      try { sample = raw ? JSON.parse(raw) : null; } catch { sample = raw as any; }
    }
    return NextResponse.json({
      ok: true,
      env: {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
        KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
      },
      canWrite: true,
      indexCount: byIndex.length,
      keysCount: keys.length,
      indexIds,
      keys: keys.slice(0, 50),
      peek,      // <- покаже, що get по id реально працює
      sample
    }, NO_STORE);
  }

  // rebuild: відбудовуємо індекс із документів
  if (act === 'rebuild') {
    const rebuilt = await healIndexFromDocs();
    const ids = await zrangeIds();
    return NextResponse.json({ ok: true, rebuilt, indexCount: ids.length }, NO_STORE);
  }

  // звичайний список
  let items = await loadByIndex();

  // якщо чомусь порожньо — читаємо напряму через SCAN
  if (!items.length) {
    items = await loadByScan();
  }

  // останній шанс — спробуємо ще й перебудувати індекс, але повернемо результат вже зараз
  if (!items.length) {
    await healIndexFromDocs();
  }

  return NextResponse.json(
    { ok: true, items, data: { items }, campaigns: items, rows: items, count: items.length },
    NO_STORE
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Any;
    const name = (body.name ?? '').toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: 'NAME_REQUIRED' }, { status: 400 });

    const now = Date.now();
    const id = genId();
    const item: Any = { ...body, id, name, created_at: now, updated_at: now };

    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, { score: now, member: id });

    return NextResponse.json({ ok: true, item }, NO_STORE);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'POST_FAILED' }, { status: 500 });
  }
}
