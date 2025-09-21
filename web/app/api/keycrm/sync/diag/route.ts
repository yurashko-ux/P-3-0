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

  // Беремо усі id кампаній з індексу (без додаткових опцій)
  const ids: string[] = (await kvZRange(INDEX, 0, -1)) || [];
  const indexCount = ids.length;

  // Семпл до 5 шт.
  const sampleIds = ids.slice(0, 5);
  const sample: Array<{ id: string; key: string; exists: boolean }> = [];

  for (const id of sampleIds) {
    const key = KEY(id);
    const val = await kvGet(key).catch(() => null);
    sample.push({ id, key, exists: val != null });
  }

  return NextResponse.json({
    ok: true,
    campaigns: { index_count: indexCount, sample },
  });
}
