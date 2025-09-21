// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

// Обережно з зовнішніми викликами: імена не обовʼязкові.
// Якщо KeyCRM тимчасово недоступний — просто повернемо null.
async function enrichNames(c: Campaign): Promise<Campaign> {
  try {
    c.base_pipeline_name = await getPipelineName(c.base_pipeline_id);
  } catch { c.base_pipeline_name = null; }
  try {
    c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id);
  } catch { c.base_status_name = null; }

  if (c.exp) {
    const ep = c.exp;
    try {
      (c as any).exp = {
        ...ep,
        to_pipeline_name: ep?.to_pipeline_id ? await getPipelineName(ep.to_pipeline_id) : null,
        to_status_name: (ep?.to_pipeline_id && ep?.to_status_id)
          ? await getStatusName(ep.to_pipeline_id, ep.to_status_id)
          : null,
      };
    } catch {
      (c as any).exp = { ...ep, to_pipeline_name: null, to_status_name: null };
    }
  }
  return c;
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // kvZRange без options; отримаємо зростаюче — розвернемо, щоб нові були першими
  const ids: string[] = (await kvZRange(INDEX, 0, -1)) || [];
  const ordered = [...ids].reverse();

  const items: Campaign[] = [];
  for (const id of ordered) {
    const raw = await kvGet<any>(KEY(id));
    if (!raw) continue;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const c = normalizeCampaign(data);
    items.push(await enrichNames(c));
  }

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // 1) зберегти повний JSON
    await kvSet(KEY(c.id), c);

    // 2) індексувати в ZSET: сигнатура kvZAdd(key, score, member)
    await kvZAdd(INDEX, c.created_at, c.id);

    // 3) відповісти тим, що реально поклали
    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    // Zod помилки або помилки KV:
    const msg =
      e?.issues?.[0]?.message ||
      e?.message ||
      'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
