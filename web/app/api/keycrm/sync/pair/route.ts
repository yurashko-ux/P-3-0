// web/app/api/keycrm/sync/pair/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const PAIR_INDEX = (p: number | string, s: number | string) => `kc:index:cards:${p}:${s}`;
const CARD_KEY = (id: number | string) => `kc:card:${id}`;

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const u = new URL(req.url);
  const pipeline_id = Number(u.searchParams.get('pipeline_id') ?? 1);
  const status_id = Number(u.searchParams.get('status_id') ?? 38);

  const pairIndexKey = PAIR_INDEX(pipeline_id, status_id);
  const now = Date.now();

  // ВАЖЛИВО: ваша обгортка kvZAdd має сигнатуру (key, score, member)
  await kvZAdd(pairIndexKey, now, String(now));

  // Записуємо тестову картку (для діагностики індексу)
  await kvSet(CARD_KEY(now), {
    demo: true,
    pipeline_id,
    status_id,
    created_at: now,
  });

  return NextResponse.json({
    ok: true,
    wrote: {
      pairIndexKey,
      score: now,
      member: String(now),
      cardKey: CARD_KEY(now),
    },
  });
}
