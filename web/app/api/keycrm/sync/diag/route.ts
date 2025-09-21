// web/app/api/keycrm/sync/diag/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // усі campaign-id з індексу (без опцій, бо kvZRange приймає 3 аргументи)
  const ids: string[] = (await kvZRange(INDEX, 0, -1)) ?? [];
  const indexCount = ids.length;

  // підтягнемо до 5 записів як семпл
  const sampleIds = ids.slice(-5).reverse(); // останні додані — першими
  const sampleKeys = sampleIds.map(KEY);
  const sample = await Promise.all(
    sampleKeys.map(async (k, i) => {
      const raw = await kvGet<any>(k).catch(() => null);
      return {
        id: sampleIds[i],
        key: k,
        exists: raw != null,
        valueType: raw == null ? null : typeof raw,
        parsed: raw && typeof raw === 'object'
          ? {
              name: raw.name ?? null,
              base_pipeline_id: raw.base_pipeline_id ?? null,
              base_status_id: raw.base_status_id ?? null,
              has_rules: !!raw.rules,
            }
          : null,
      };
    })
  );

  return NextResponse.json({
    ok: true,
    indexCount,
    sampleIds,
    sample,
  });
}
