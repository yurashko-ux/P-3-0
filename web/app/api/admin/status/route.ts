// web/app/api/admin/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';

const INDEX = 'campaigns:index';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // KV probe (write -> read)
  const probeKey = 'debug:kv:probe';
  const ts = Date.now();
  let kvProbe: any = null;
  try {
    await kvSet(probeKey, { ts });
    kvProbe = await kvGet(probeKey);
  } catch (e: any) {
    kvProbe = { error: e?.message || String(e) };
  }

  // campaigns index (safe)
  let ids: string[] = [];
  try {
    ids = (await kvZRange(INDEX, 0, -1)) || [];
  } catch {
    ids = [];
  }
  const count = ids.length;
  // покажемо максимум 10 останніх (за score зростаюче → візьмемо хвіст і розвернемо)
  const head = ids.slice(-10).reverse();

  return NextResponse.json({
    ok: true,
    meta: {
      campaigns_index_count: count,
      campaigns_index_head: head,
      kv_health_probe: kvProbe,
      time: new Date().toISOString(),
    },
  });
}
