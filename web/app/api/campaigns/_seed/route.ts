// web/app/api/campaigns/_seed/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../../lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

export async function GET() {
  const now = Date.now();
  const id = 'SEED_' + genId();
  const item = {
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

  try {
    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, { score: now, member: id });

    // спробуємо відразу повернути все, що бачимо через GET-логіку
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
    const raws = ids.length ? (await redis.mget(...ids.map(ITEM_KEY))) as (string | null)[] : [];
    const items = (raws || []).map(r => { try { return r ? JSON.parse(r) : null; } catch { return null; } }).filter(Boolean);

    return NextResponse.json({ ok: true, created: id, count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'SEED_FAILED' }, { status: 500 });
  }
}
