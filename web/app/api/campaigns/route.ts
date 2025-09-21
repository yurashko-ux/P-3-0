// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
// Імпортимо кеш назв тільки для GET, але обгортаємо виклики try/catch
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

// Допоміжно: безпечне збагачення назвами (не падає, якщо KeyCRM 404/405/…)
async function enrichNamesSafe(c: Campaign): Promise<Campaign> {
  try {
    c.base_pipeline_name = await getPipelineName(c.base_pipeline_id).catch(() => null);
  } catch { c.base_pipeline_name = null; }
  try {
    c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id).catch(() => null);
  } catch { c.base_status_name = null; }

  if (c.exp) {
    const ep = c.exp;
    let to_pipeline_name: string | null = null;
    let to_status_name: string | null = null;
    try {
      to_pipeline_name = await getPipelineName(ep.to_pipeline_id ?? null).catch(() => null);
    } catch { /* noop */ }
    try {
      to_status_name = await getStatusName(ep.to_pipeline_id ?? c.base_pipeline_id, ep.to_status_id ?? null).catch(() => null);
    } catch { /* noop */ }
    (c as any).exp = { ...ep, to_pipeline_name, to_status_name };
  }
  return c;
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // kvZRange — тільки (key, start, end). Беремо все і реверсимо, щоб нові були зверху.
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

    // Збагачення назвами — ТІЛЬКИ у GET, і без падінь при помилках зовнішнього API
    await enrichNamesSafe(c);

    items.push(c);
  }

  return NextResponse.json(items, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // ЗБЕРЕГТИ: без будь-яких звернень до KeyCRM
    await kvSet(KEY(c.id), c);

    // У твоєму kvZAdd — сигнатура (key, score, member)
    await kvZAdd(INDEX, c.created_at, c.id);

    // Повертаємо ЩО ЗБЕРЕГЛИ, без збагачення назвами (щоб не ловити 404 від KeyCRM)
    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg =
      e?.issues?.[0]?.message ||
      e?.message ||
      'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
