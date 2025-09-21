// web/app/api/keycrm/sync/diag/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  // Беремо всі id з індексу. Наш kvZRange має сигнатуру (key, start, end),
  // тож без {rev:true}. Розвернемо в JS.
  const ids: string[] = (await kvZRange(INDEX, 0, -1)) || [];
  const idsDesc = [...ids].reverse();

  // Підтягнемо до 5 штук як семпл
  const sampleIds = idsDesc.slice(0, 5);
  const sample: any[] = [];
  for (const id of sampleIds) {
    const raw = await kvGet<any>(KEY(id)).catch(() => null);
    sample.push({
      id,
      exists: !!raw,
      valueType: raw ? typeof raw : null,
      name: raw?.name ?? null,
      base_pipeline_id: raw?.base_pipeline_id ?? null,
      base_status_id: raw?.base_status_id ?? null,
      created_at: raw?.created_at ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    index_count: ids.length,
    sample_ids: sampleIds,
    sample,
  });
}
