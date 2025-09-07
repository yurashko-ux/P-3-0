// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Any = Record<string, any>;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

const NO_STORE = { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } };

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

// ---- helpers ---------------------------------------------------------------

async function zrangeIds(): Promise<string[]> {
  return (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
}

async function loadByIndex(): Promise<Any[]> {
  const ids = await zrangeIds();
  if (!ids.length) return [];
  const raws = (await redis.mget(...ids.map(ITEM_KEY))) as (string | null)[];
  return (raws || []).map(r => { try { return r ? JSON.parse(r) : null; } catch { return null; } }).filter(Boolean) as Any[];
}

async function scanAll(match: string, count = 200): Promise<string[]> {
  let cursor = 0; const acc: string[] = [];
  while (true) {
    const res: any = await (redis as any).scan(cursor, { match, count });
    const next = Array.isArray(res) ? Number(res[0]) : Number(res?.cursor ?? 0);
    const keys = Array.isArray(res) ? (res[1] as string[]) : ((res?.keys as string[]) ?? []);
    if (keys?.length) acc.push(...keys);
    cursor = next; if (!cursor) break;
  }
  return acc;
}

function looksLikeDocKey(k: string) {
  // пропускаємо службові ключі
  if (k === INDEX_KEY) return false;
  if (k.startsWith('campaigns:__probe__')) return false;
  if (k.endsWith(':index')) return false;
  return k.startsWith('campaigns:');
}

async function healIndexFromDocs(): Promise<number> {
  const keys = await scanAll('campaigns:*');
  const docKeys = keys.filter(looksLikeDocKey);
  if (!docKeys.length) return 0;

  const raws = (await redis.mget(...docKeys)) as (string | null)[];
  let rebuilt = 0;
  for (const raw of raws) {
    if (!raw) continue;
    try {
      const item = JSON.parse(raw);
      const id = item?.id; if (!id) continue;
      const score = Number(item.created_at) || Date.now();
      await redis.zadd(INDEX_KEY, { score, member: String(id) });
      rebuilt++;
    } catch { /* ignore */ }
  }
  return rebuilt;
}

// ---- handlers --------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const act =
    url.searchParams.get('__act') ||
    url.searchParams.get('act') ||
    (url.searchParams.has('seed') ? 'seed' :
     url.searchParams.has('debug') ? 'debug' :
     url.searchParams.has('rebuild') ? 'rebuild' : '');

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

  // debug: що реально лежить у KV / індексі
  if (act === 'debug') {
    const byIndex = await loadByIndex();
    const keys = await scanAll('campaigns:*');
    const indexIds = await zrangeIds();
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
  if (!items.length) {
    const rebuilt = await healIndexFromDocs();
    if (rebuilt) items = await loadByIndex();
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
