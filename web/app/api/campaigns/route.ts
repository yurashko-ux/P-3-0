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
        KV
