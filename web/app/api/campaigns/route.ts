// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Any = Record<string, any>;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

async function loadByIndex(): Promise<Any[]> {
  const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
  if (!ids?.length) return [];
  const raws = (await redis.mget(...ids.map(ITEM_KEY))) as (string | null)[];
  return (raws || [])
    .map((raw) => {
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    })
    .filter(Boolean) as Any[];
}

async function scanAllKeys(match: string, count = 200): Promise<string[]> {
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

async function healIndexFromDocs(): Promise<Any[]> {
  const keys = await scanAllKeys('campaigns:*');
  const docKeys = keys.filter((k) => k !== INDEX_KEY && !k.endsWith(':index'));
  if (!docKeys.length) return [];
  const raws = (await redis.mget(...docKeys)) as (string | null)[];
  const items = (raws || [])
    .map((raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })
    .filter(Boolean) as Any[];

  // Відбудовуємо індекс простим циклом (типобезпечніше)
  for (const it of items) {
    if (it?.id) {
      const score = Number(it.created_at) || Date.now();
      await redis.zadd(INDEX_KEY, { score, member: String(it.id) });
    }
  }
  return items.sort((a, b) => (Number(b?.created_at || 0) - Number(a?.created_at || 0)));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const act =
      url.searchParams.get('__act') ||
      url.searchParams.get('act') ||
      (url.searchParams.has('seed') ? 'seed' : url.searchParams.has('debug') ? 'debug' : '');

    // ---- /api/campaigns?__act=seed ----
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
      const items = await loadByIndex();
      return NextResponse.json({ ok: true, created: id, count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ---- /api/campaigns?__act=debug ----
    if (act === 'debug') {
      const env = {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
        KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
      };
      let canWrite = false, writeError = '';
      try {
        const probe = `campaigns:__probe__:${Date.now()}`;
        await redis.set(probe, JSON.stringify({ t: Date.now() }));
        await redis.del(probe);
        canWrite = true;
      } catch (e: any) {
        canWrite = false; writeError = e?.message || String(e);
      }
      const byIndex = await loadByIndex();
      const keys = await scanAllKeys('campaigns:*');
      return NextResponse.json({
        ok: true, env, canWrite, writeError,
        indexCount: byIndex.length,
        keysCount: keys.length,
        sample: byIndex[0] ?? null
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ---- звичайний список ----
    let items = await loadByIndex();
    if (!items.length) {
      items = await healIndexFromDocs();
    }

    const payload = {
      ok: true,
      items,
      data: { items },
      campaigns: items,
      rows: items,
      count: items.length,
    };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'GET_FAILED' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Any;
    const name = (body.name ?? '').toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: 'NAME_REQUIRED' }, { status: 400 });

    const now = Date.now();
    const id = genId();
    const item: Any = { ...body, id, name, created_at: now, updated_at: now };

    if (item.enabled === undefined) item.enabled = true;
    if (item.exp_days != null) item.exp_days = Number(item.exp_days);
    if (item.lastRun === undefined) item.lastRun = null;
    if (item.v1_count == null) item.v1_count = 0;
    if (item.v2_count == null) item.v2_count = 0;
    if (item.exp_count == null) item.exp_count = 0;

    item.base_pipeline_id ??= null;
    item.base_status_id ??= null;
    item.v1_to_pipeline_id ??= null;
    item.v1_to_status_id ??= null;
    item.v2_to_pipeline_id ??= null;
    item.v2_to_status_id ??= null;

    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, { score: now, member: id });

    return NextResponse.json({ ok: true, item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'POST_FAILED' }, { status: 500 });
  }
}
