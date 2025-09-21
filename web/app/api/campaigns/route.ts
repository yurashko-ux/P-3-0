// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

/** Локальний обхід проблеми kvZAdd: прямий REST-виклик Upstash ZADD */
async function zaddDirect(key: string, score: number, member: string) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) throw new Error('KV REST env missing');

  const url = `${base}/zadd/${encodeURIComponent(key)}/${score}/${encodeURIComponent(member)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || (json && json.error)) {
    throw new Error(`Upstash ZADD failed: ${json?.error || res.statusText}`);
  }
  return json?.result ?? null;
}

async function enrichNames(c: Campaign): Promise<Campaign> {
  try { c.base_pipeline_name = await getPipelineName(c.base_pipeline_id); } catch { c.base_pipeline_name = null; }
  try { c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id); } catch { c.base_status_name = null; }

  if (c.exp) {
    const ep = c.exp;
    try {
      (c as any).exp = {
        ...ep,
        to_pipeline_name: ep?.to_pipeline_id ? await getPipelineName(ep.to_pipeline_id) : null,
        to_status_name:
          ep?.to_pipeline_id && ep?.to_status_id
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

  // kvZRange без options -> відсортовано за зростанням; розвернемо в пам’яті
  const ids: string[] = (await kvZRange(INDEX, 0, -1)) || [];
  const ordered = [...ids].reverse();

  const items: Campaign[] = [];
  for (const id of ordered) {
    const raw = await kvGet<any>(KEY(id));
    if (!raw) continue;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const c = await enrichNames(normalizeCampaign(data));
    items.push(c);
  }

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // 1) зберігаємо JSON
    await kvSet(KEY(c.id), c);

    // 2) індексуємо напряму через Upstash REST ZADD (обхід kvZAdd)
    await zaddDirect(INDEX, c.created_at, c.id);

    // 3) повертаємо те, що реально поклали (без обов’язкового збагачення — щоб не чіпати KeyCRM)
    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
