// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

const norm = (s: string) => s.trim().toLowerCase();

function formDataToObject(fd: FormData) {
  const obj: Record<string, any> = {};
  for (const [k, v] of fd.entries()) {
    // якщо ключі вигляду a.b — покладемо як "a.b" (наша підготовка в lib/types.ts це врахує)
    obj[k] = typeof v === 'string' ? v : (v as File).name;
  }
  return obj;
}

async function readBody(req: NextRequest): Promise<any> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return await req.json();
  }
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    return formDataToObject(fd);
  }
  // як запасний варіант спробуємо text -> JSON
  const txt = await req.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { _raw: txt };
  }
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids?.length) return NextResponse.json([]);

  const rawList = await Promise.all(ids.map((id) => kvGet<any>(KEY(id))));
  const items: Campaign[] = [];

  for (const raw of rawList) {
    if (!raw) continue;
    const c = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);

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

  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const url = new URL(req.url);
    const allowDup = url.searchParams.get('allow_duplicate') === '1';

    // ← читаємо JSON або FormData
    const body = (await readBody(req)) as CampaignInput;
    const c = normalizeCampaign(body);

    // глобальні перевірки унікальності значень (v1/v2) уже реалізовані раніше,
    // якщо вони в тебе в цій версії, лишай; якщо ні — можна додати назад

    await kvSet(KEY(c.id), c);
    // kvZAdd: (key, score, member)
    await kvZAdd(INDEX, c.created_at, c.id);

    return new Response(JSON.stringify(c), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    // невелика підказка для дебага з фронту
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
