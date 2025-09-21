// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { CampaignInput, Campaign, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

// GET /api/campaigns  — віддає всі кампанії з KV (без звернень до KeyCRM)
export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = (await kvZRange(INDEX, 0, -1)) || [];
  if (!ids.length) return NextResponse.json([]);

  // ZSET повертає зростаюче — віддамо у зворотньому порядку (нові згори)
  const ordered = ids.slice().reverse();

  const items: Campaign[] = [];
  for (const id of ordered) {
    const raw = await kvGet<any>(KEY(id)).catch(() => null);
    if (!raw) continue;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    items.push(normalizeCampaign(obj));
  }

  return NextResponse.json(items, { status: 200 });
}

// POST /api/campaigns — створює/оновлює одну кампанію в KV
export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // повний JSON
    await kvSet(KEY(c.id), c);

    // індекс за created_at (увага: у твоїй обгортці kvZAdd приймає об'єкт {score, member})
    await kvZAdd(INDEX, { score: c.created_at, member: c.id });

    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
