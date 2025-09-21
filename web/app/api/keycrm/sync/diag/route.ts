// web/app/api/keycrm/sync/diag/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Перевірка адміна (Bearer або ?pass=)
  await assertAdmin(req);

  // Беремо усі id кампаній з індексу
  const ids: string[] = (await kvZRange(INDEX, 0, -1, { rev: true })) || [];
  const indexCount = ids.length;

  // Підтягнемо до 5 штук як семпл (без kvMGet — однаково швидко для діагностики)
  const sampleIds = ids.slice(0, 5);
  const sample: Array<{
    id: string;
    exists: boolean;
    key: string;
  }> = [];

  for (const id of sampleIds) {
    const key = KEY(id);
    const val = await kvGet(key);
    sample.push({ id, key, exists: val != null });
  }

  return NextResponse.json({
    ok: true,
    campaigns: { index_count: indexCount, sample },
  });
}
