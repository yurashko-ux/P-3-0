// web/app/api/admin/campaigns/repair/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

/**
 * GET -> легкий статус: що є в індексі та скільки реально існує значень.
 */
export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = await kvZRange(INDEX, 0, -1, { rev: true }).catch(() => []);
  const keys = ids.map(KEY);

  let exists = 0;
  const sample: Array<{ id: string; exists: boolean }> = [];

  for (let i = 0; i < Math.min(keys.length, 10); i++) {
    const id = ids[i];
    const raw = await kvGet(KEY(id)).catch(() => null);
    const ok = !!raw;
    if (ok) exists++;
    sample.push({ id, exists: ok });
  }

  return NextResponse.json({
    ok: true,
    index_count: ids.length,
    first_10: sample,
    note: 'POST на цей ендпойнт спробує нормалізувати всі наявні кампанії (додасть дефолтні поля тощо).',
  });
}

/**
 * POST -> «ремонт»: проходить по всіх campaign keys, підтягує дефолти (rules.v2, counters),
 * та перезаписує значення у KV у нормалізованому вигляді.
 */
export async function POST(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = await kvZRange(INDEX, 0, -1, { rev: true }).catch(() => []);
  let normalized = 0;
  let skipped = 0;

  for (const id of ids) {
    const key = KEY(id);
    const raw = await kvGet<any>(key).catch(() => null);
    if (!raw) {
      skipped++;
      continue;
    }

    // raw може бути рядком або об’єктом
    const asObj: CampaignInput = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Гарантуємо дефолти (rules.v2, counters, created_at, active тощо)
    let fixed: Campaign;
    try {
      fixed = normalizeCampaign(asObj);
    } catch (e: any) {
      skipped++;
      continue;
    }

    // Перезаписуємо назад у KV
    await kvSet(key, fixed).catch(() => null);
    normalized++;
  }

  return NextResponse.json({
    ok: true,
    index_count: ids.length,
    normalized,
    skipped,
    hint:
      'Якщо після цього список порожній — у індексі є ID без самих об’єктів у KV. ' +
      'У такому випадку створіть першу кампанію вручну через UI, або скажіть — зроблю окремий cleanup-рут.',
  });
}
