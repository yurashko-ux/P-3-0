// web/app/api/debug/kv/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ts = Date.now();
  const testKey = 'debug:kv:test';

  // Пишемо та читаємо назад для перевірки KV round-trip
  const payload = { ts, note: 'KV round-trip test' };
  await kvSet(testKey, payload);

  const readBack = await kvGet<any>(testKey).catch(() => null);

  return NextResponse.json({
    ok: true,
    wrote: payload,
    read: readBack ?? null,
    same: !!readBack && readBack.ts === ts,
  });
}
