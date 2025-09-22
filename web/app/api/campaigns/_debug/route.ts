// web/app/api/campaigns/_debug/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaigns:index';      // ZSET: score=created_at, member=id
const LIST_KEY  = 'campaigns:all';        // LIST: ids (нові зверху)
const ITEMS_KEY = 'campaigns:items';      // LIST: JSON кампаній (нові зверху)
const ITEM_KEY  = (id: string) => `campaigns:${id}`;

export async function GET() {
  const env = {
    KV_URL: !!process.env.KV_REST_API_URL || !!process.env.KV_URL,
    KV_TOKEN: !!process.env.KV_REST_API_TOKEN || !!process.env.KV_REST_API_READ_ONLY_TOKEN,
  };

  try {
    // індекси
    const zAsc  = await redis.zrange(INDEX_KEY, 0, -1).catch(() => []);
    const zDesc = await redis.zrange(INDEX_KEY, 0, -1, { rev: true }).catch(() => []);
    const lIds  = await redis.lrange(LIST_KEY, 0, -1).catch(() => []);
    const rawItems = await redis.lrange(ITEMS_KEY, 0, -1).catch(() => []);

    // sample з ITEM_KEY
    let sample: any = null;
    if (zDesc?.[0]) {
      const raw = await redis.get(ITEM_KEY(String(zDesc[0])));
      if (raw) {
        try { sample = JSON.parse(raw); } catch { sample = raw; }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        env,
        index: { zAsc, zDesc, lIds, itemsLen: rawItems.length },
        sample,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, env, error: e?.message || String(e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
