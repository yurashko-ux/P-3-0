// web/app/api/campaigns/route.ts
// GET  → масив кампаній (новіші зверху), гарантує rules.v1/v2
// POST → створення/апсертування кампанії, індексація у campaigns:index (score=created_at)
//       Дублюємо id у LIST campaigns:all і сам об’єкт у LIST campaigns:items —
//       щоб GET завжди мав хоча б один надійний фолбек.

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { assertAdmin } from '@/lib/auth';
import { normalizeCampaign, type Campaign, type CampaignWithNames } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '11111';
const INDEX_KEY = 'campaigns:index';      // ZSET: score = created_at, member = id
const LIST_KEY  = 'campaigns:all';        // LIST: LPUSH id (нові зверху)
const ITEMS_KEY = 'campaigns:items';      // LIST: LPUSH JSON.stringify(item) (нові зверху)
const ITEM_KEY  = (id: string) => `campaigns:${id}`;

// ——— kc-cache: збагачення назв, але не ламаємось якщо модуль відсутній
async function safeGetPipelineName(id: number): Promise<string | null> {
  try {
    const mod = await import('@/lib/kc-cache');
    if (typeof (mod as any).getPipelineName === 'function') {
      return ((mod as any).getPipelineName as (x: number) => Promise<string | null>)(id);
    }
  } catch { /* ignore */ }
  return null;
}
async function safeGetStatusName(id: number): Promise<string | null> {
  try {
    const mod = await import('@/lib/kc-cache');
    if (typeof (mod as any).getStatusName === 'function') {
      return ((mod as any).getStatusName as (x: number) => Promise<string | null>)(id);
    }
  } catch { /* ignore */ }
  return null;
}
async function enrich(c: Campaign): Promise<CampaignWithNames> {
  const base_pipeline_name = await safeGetPipelineName(c.base_pipeline_id);
  const base_status_name   = await safeGetStatusName(c.base_status_id);
  let exp: CampaignWithNames['exp'] = null;
  if (c.exp) {
    exp = {
      ...c.exp,
      to_pipeline_name: await safeGetPipelineName(c.exp.to_pipeline_id),
      to_status_name: await safeGetStatusName(c.exp.to_status_id),
    };
  }
  return { ...c, base_pipeline_name, base_status_name, exp };
}

// ——— дістаємо всі id з індексу з фолбеками
async function getAllCampaignIdsNewestFirst(): Promise<string[]> {
  // 1) ZSET
  const zIds = (await redis.zrange(INDEX_KEY, 0, -1).catch(() => [])) as string[];
  if (Array.isArray(zIds) && zIds.length) return [...zIds].reverse();

  // 2) LIST з id
  const lIds = (await redis.lrange(LIST_KEY, 0, -1).catch(() => [])) as string[];
  if (Array.isArray(lIds) && lIds.length) return lIds;

  return [];
}

// ——— GET
export async function GET() {
  try {
    const ids = await getAllCampaignIdsNewestFirst();

    // 1) основний шлях — тягнемо по id
    const items: CampaignWithNames[] = [];
    for (const id of ids) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try { items.push(await enrich(JSON.parse(raw) as Campaign)); } catch { /* skip */ }
    }

    // 2) фолбек останньої інстанції — читаємо список готових JSON-ів
    if (!items.length) {
      const raws = (await redis.lrange(ITEMS_KEY, 0, -1).catch(() => [])) as string[];
      for (const r of raws) {
        try { items.push(await enrich(JSON.parse(r) as Campaign)); } catch { /* skip */ }
      }
    }

    return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

// ——— POST
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    if (String(body?.pass || '') !== ADMIN_TOKEN) {
      await assertAdmin(new Request(req.url, { method: req.method, headers: req.headers }));
    }

    const { pass: _omit, ...payload } = body || {};
    const item = normalizeCampaign(payload); // гарантії: rules.v1/v2, uuid, лічильники

    // 1) KV: сам об’єкт
    await redis.set(ITEM_KEY(item.id), JSON.stringify(item));

    // 2) індекси
    await redis.zadd(INDEX_KEY, { score: item.created_at, member: String(item.id) }).catch(() => {});
    await redis.lpush(LIST_KEY, String(item.id)).catch(() => {});
    await redis.lpush(ITEMS_KEY, JSON.stringify(item)).catch(() => {});

    const enriched = await enrich(item);
    return NextResponse.json({ ok: true, item: enriched }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : /invalid campaign|invalid/i.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
