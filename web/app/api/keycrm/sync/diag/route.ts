// web/app/api/keycrm/sync/diag/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

const CAMPAIGNS_INDEX = 'campaigns:index';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // Витягаємо всі id з індексу кампаній (від нових до старих)
  const ids: string[] = (await kvZRange(CAMPAIGNS_INDEX, 0, -1, { rev: true })) || [];

  // Спробуємо показати кілька ключів/значень для дебагу
  const meta = {
    campaigns_index_count: ids.length,
    campaigns_index_head: ids.slice(0, 10),
    kv_health_probe: await kvGet<string>('health:probe').catch(() => null),
  };

  return NextResponse.json({ ok: true, meta });
}
