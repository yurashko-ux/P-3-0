// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

const IDS_KEY = 'campaigns:ids';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

// GET: віддаємо всі кампанії, відсортовані за created_at спадно.
// ЖОДНИХ ZSET — лише простий масив id у KV.
export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = (await kvGet<string[]>(IDS_KEY)) || [];
  if (!ids.length) return NextResponse.json([], { status: 200 });

  // тягнемо по одному (kvMGet не використовуємо, щоб уникнути несумісності)
  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet<any>(KEY(id)).catch(() => null);
    if (!raw) continue;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    items.push(normalizeCampaign(obj));
  }

  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return NextResponse.json(items, { status: 200 });
}

// POST: створення/оновлення кампанії.
// Зберігаємо JSON у campaigns:{id} та підтримуємо масив id у campaigns:ids (без дублів).
export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // 1) сама кампанія
    await kvSet(KEY(c.id), c);

    // 2) список id (без дублікатів)
    const ids: string[] = (await kvGet<string[]>(IDS_KEY)) || [];
    if (!ids.includes(c.id)) {
      ids.push(c.id);
      await kvSet(IDS_KEY, ids);
    }

    // 3) повертаємо те, що реально зберегли (без будь-яких зовнішніх збагачень)
    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
