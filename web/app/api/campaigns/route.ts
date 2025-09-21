// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

const IDS_KEY = 'campaigns:ids';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

// GET /api/campaigns — читаємо всі id зі списку, тягнемо об'єкти, сортуємо за created_at desc
export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = (await kvGet<string[]>(IDS_KEY)) || [];
  if (!ids.length) return NextResponse.json([], { status: 200 });

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

// POST /api/campaigns — створити/оновити кампанію
export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // зберігаємо саму кампанію
    await kvSet(KEY(c.id), c);

    // оновлюємо список id (без дублікатів)
    const ids: string[] = (await kvGet<string[]>(IDS_KEY)) || [];
    if (!ids.includes(c.id)) {
      ids.push(c.id);
      await kvSet(IDS_KEY, ids);
    }

    // відповідаємо тим, що реально зберегли
    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
