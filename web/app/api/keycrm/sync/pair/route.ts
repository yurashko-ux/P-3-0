// web/app/api/keycrm/sync/pair/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const PAIR_INDEX = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const CARD_KEY = (id: number | string) => `kc:card:${id}`;

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const u = new URL(req.url);
  const pipeline_id = Number(u.searchParams.get('pipeline_id') || '');
  const status_id = Number(u.searchParams.get('status_id') || '');
  const per_page = Number(u.searchParams.get('per_page') || 50);
  const max_pages = Number(u.searchParams.get('max_pages') || 1);

  if (!pipeline_id || !status_id) {
    return NextResponse.json(
      { ok: false, error: 'pipeline_id and status_id are required' },
      { status: 400 }
    );
  }

  // Stub без top-level await — лише перевірка, що роут і KV працюють
  const pairIndexKey = PAIR_INDEX(pipeline_id, status_id);
  const now = Date.now();

  // правильна сигнатура kvZAdd: (key, { score, member })
  await kvZAdd(pairIndexKey, { score: now, member: String(now) });
  await kvSet(CARD_KEY(now), { demo: true, pipeline_id, status_id, created_at: now });

  return NextResponse.json({
    ok: true,
    note: 'Stub sync executed (no top-level await). Replace with real KeyCRM loop later.',
    used: { pipeline_id, status_id, per_page, max_pages },
    wrote: {
      pair_index_key: pairIndexKey,
      demo_member: String(now),
      card_key: CARD_KEY(now),
    },
  });
}
