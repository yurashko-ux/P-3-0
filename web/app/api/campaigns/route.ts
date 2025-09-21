// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // Уникаємо опцій у kvZRange (деякі реалізації їх не підтримують)
  let ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids || !ids.length) return NextResponse.json([]);

  // Хочемо нові зверху — просто розвертаємо масив
  ids = ids.reverse();

  const keys = ids.map(KEY);

  // Без kvMGet: читаємо по одному — простіше і надійніше
  const rawList = await Promise.all(keys.map((k) => kvGet<any>(k)));

  const items: Campaign[] = [];
  for (const raw of rawList) {
    if (!raw) continue;
    const c = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);

    // збагачення назвами
    c.base_pipeline_name = await getPipelineName(c.base_pipeline_id);
    c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id);

    if (c.exp) {
      const ep = c.exp;
      (c as any).exp = {
        ...ep,
        to_pipeline_name: await getPipelineName(ep.to_pipeline_id),
        to_status_name: await getStatusName(
          ep.to_pipeline_id ?? c.base_pipeline_id,
          ep.to_status_id ?? null
        ),
      };
    }

    items.push(c);
  }

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // зберігаємо повний JSON кампанії
    await kvSet(KEY(c.id), c);

    // ВАЖЛИВО: правильна сигнатура kvZAdd — один об’єкт { score, member }
    await kvZAdd(INDEX, { score: c.created_at, member: c.id });

    // Повертаємо те, що зберегли (без звернень до KeyCRM)
    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
