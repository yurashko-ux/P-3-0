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
  return (raws || []).map(r => { try { return r ? JSON.parse(r) : null; } catch { return null; } }).filter(Boolean) as Any[];
}

async function scanAllKeys(match: string, count = 200): Promise<string[]> {
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

async function healIndexFromDocs(): Promise<Any[]> {
  const keys = await scanAllKeys('campaigns:*');
  const docKeys = keys.filter(k => k !== INDEX_KEY && !k.endsWith(':index'));
  if (!docKeys.length) return [];
  const raws = (await redis.mget(...docKeys)) as (string | null)[];
  const items = (raws || []).map(r => { try { return r ? JSON.parse(r) : null; } catch { return null; } }).filter(Boolean) as Any[];
  // відбудовуємо індекс
  for (const it of items) {
    if (it?.id) {
      const score = Number(it.created_at) || Date.now();
      await redis.zadd(INDEX_KEY, { score, member: String(it.id) });
    }
  }
  return items.sort((a, b) => (Number(b?.created_at || 0) - Number(a?.created_at || 0)));
}

function noStore() {
  return { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const act =
    url.searchParams.get('__act') ||
    url.searchParams.get('act') ||
    (url.searchParams.has('debug') ? 'debug' : url.searchParams.has('rebuild') ? 'rebuild' : '');

  // --- діагностика ---
  if (act === 'debug') {
    const byIndex = await loadByIndex();
    const keys = await scanAllKeys('campaigns:*');
    return NextResponse.json({
      ok: true,
      indexCount: byIndex.length,
      keysCount: keys.length,
      indexSample: byIndex[0] ?? null,
      keyPrefix: 'campaigns:*',
      indexKey: INDEX_KEY,
    }, noStore());
  }

  // --- ручна відбудова індексу ---
  if (act === 'rebuild') {
    const items = await healIndexFromDocs();
    return NextResponse.json({ ok: true, rebuilt: items.length }, noStore());
  }

  // --- звичайний список ---
  let items = await loadByIndex();
  if (!items.length) items = await healIndexFromDocs();
  return NextResponse.json(
    { ok: true, items, data: { items }, campaigns: items, rows: items, count: items.length },
    noStore()
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
    await redis.zadd(INDEX_KEY, { score: now, member: id }); // <- важливо!

    return NextResponse.json({ ok: true, item }, noStore());
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'POST_FAILED' }, { status: 500 });
  }
}
