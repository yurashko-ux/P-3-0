// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // kvZRange приймає 3 аргументи. Беремо все і самі реверсимо для останніх зверху.
  const ids: string[] = await kvZRange(INDEX, 0, -1).catch(() => []);
  ids.reverse();

  if (!ids.length) {
    return NextResponse.json([], { status: 200 });
  }

  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet<any>(KEY(id)).catch(() => null);
    if (!raw) continue;

    const c = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);

    // збагачення назвами
    c.base_pipeline_name = await getPipelineName(c.base_pipeline_id);
    c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id);

    if (c.exp) {
      const ep = c.exp;
      (c as any).exp = {
        ...ep,
        to_pipeline_name: await getPipelineName(ep.to_pipeline_id ?? null),
        to_status_name: await getStatusName(ep.to_pipeline_id ?? c.base_pipeline_id, ep.to_status_id ?? null),
      };
    }

    items.push(c);
  }

  return NextResponse.json(items, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    await kvSet(KEY(c.id), c);

    // kvZAdd має сигнатуру (key, score, member)
    await kvZAdd(INDEX, c.created_at, c.id);

    // повертаємо з уже збагаченими назвами, щоб UI одразу показав
    c.base_pipeline_name = await getPipelineName(c.base_pipeline_id);
    c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id);
    if (c.exp) {
      const ep = c.exp;
      (c as any).exp = {
        ...ep,
        to_pipeline_name: await getPipelineName(ep.to_pipeline_id ?? null),
        to_status_name: await getStatusName(ep.to_pipeline_id ?? c.base_pipeline_id, ep.to_status_id ?? null),
      };
    }

    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
