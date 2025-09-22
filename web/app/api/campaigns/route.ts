// web/app/api/campaigns/route.ts
// GET  → повертає масив кампаній (новіші зверху), гарантує наявність rules.v1/v2
// POST → створення/апсертування кампанії, індексація у campaigns:index (score=created_at)

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { assertAdmin } from '@/lib/auth';
import { normalizeCampaign, type Campaign, type CampaignWithNames } from '@/lib/types';

export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

// ——— опційне збагачення назв з kc-cache; якщо модуль відсутній — повертаємо null-и
async function safeGetPipelineName(id: number): Promise<string | null> {
  try {
    const mod = await import('@/lib/kc-cache');
    if (typeof (mod as any).getPipelineName === 'function') {
      return ((mod as any).getPipelineName as (x: number) => Promise<string | null>)(id);
    }
  } catch {/* ignore */}
  return null;
}

async function safeGetStatusName(id: number): Promise<string | null> {
  try {
    const mod = await import('@/lib/kc-cache');
    if (typeof (mod as any).getStatusName === 'function') {
      return ((mod as any).getStatusName as (x: number) => Promise<string | null>)(id);
    }
  } catch {/* ignore */}
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

  return {
    ...c,
    base_pipeline_name,
    base_status_name,
    exp,
  };
}

// ——— GET: список кампаній
export async function GET() {
  try {
    // дістаємо всі id з індексу; якщо наша in-memory реалізація не підтримує опції — просто розвернемо список
    const ids = await redis.zrange(INDEX_KEY, 0, -1).catch(() => []) as string[];
    const ordered = Array.isArray(ids) ? [...ids].reverse() : [];

    const items: CampaignWithNames[] = [];
    for (const id of ordered) {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Campaign;
        // safety: normalize ще раз не потрібен — ми писали нормалізоване
        items.push(await enrich(parsed));
      } catch {/* skip corrupted */}
    }

    return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

// ——— POST: створення/апсертування
export async function POST(req: Request) {
  try {
    await assertAdmin(req);

    const payload = await req.json().catch(() => ({}));
    const item = normalizeCampaign(payload); // гарантує rules.v1/v2, uuid, лічильники

    // збереження
    await redis.set(ITEM_KEY(item.id), JSON.stringify(item));

    // індексація (score = created_at)
    await redis.zadd(INDEX_KEY, { score: item.created_at, member: String(item.id) }).catch(() => {});

    // повертаємо збагачений варіант для UI
    const enriched = await enrich(item);

    return NextResponse.json(
      { ok: true, item: enriched },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    // якщо normalize кинув помилку валідації — віддамо 400
    const msg = e?.message || String(e);
    const status = /invalid campaign|invalid/i.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
