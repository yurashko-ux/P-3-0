// web/app/api/admin/campaigns/repair/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvMGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const url = new URL(req.url);
  const seed = url.searchParams.get('seed'); // seed=1 — створити демо-кампанію

  let seeded: Campaign | null = null;

  if (seed) {
    // мінімальна валідна демо-кампанія, щоб UI гарантовано щось побачив
    const demo: CampaignInput = {
      name: 'DEMO: Пошук по title (V1)',
      base_pipeline_id: 1,        // підстав свої значення за потреби
      base_status_id: 38,         // підстав свої значення за потреби
      rules: {
        v1: { op: 'contains', value: 'Viktoria' }, // будь-яке не порожнє значення
        // v2 опціональний, бекенд сам додасть { value: '' }
      },
      active: true,
    };

    const c = normalizeCampaign(demo);
    await kvSet(KEY(c.id), c);
    await kvZAdd(INDEX, { score: c.created_at, member: c.id });
    seeded = c;
  }

  // читаємо індекс і збираємо всі, хто існує
  const ids: string[] = await kvZRange(INDEX, 0, -1, { rev: true });
  const keys = ids.map(KEY);
  const raw = keys.length ? await kvMGet(keys) : [];

  const items: Campaign[] = [];
  for (const r of raw) {
    if (!r) continue;
    const obj = typeof r === 'string' ? JSON.parse(r) : r;
    items.push(normalizeCampaign(obj));
  }

  return NextResponse.json({
    ok: true,
    seeded: !!seed,
    seeded_id: seeded?.id ?? null,
    count: items.length,
    ids,
    items,
  });
}
