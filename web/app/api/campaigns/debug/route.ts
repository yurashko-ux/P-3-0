// web/app/api/campaigns/debug/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin, isAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export async function GET(req: NextRequest) {
  // Показуємо, чи авторизовані (через Bearer або ?pass=)
  const authed = isAdmin(req);

  // Якщо хочеш змусити 401 — раскоментуй наступний рядок:
  // await assertAdmin(req);

  // Знімаємо індекс і збираємо короткий семпл
  const ids: string[] = await kvZRange(INDEX, 0, -1).catch(() => []);
  ids.reverse(); // новіші зверху

  const limit = 10;
  const sample: Array<{
    id: string;
    exists: boolean;
    name?: string | null;
    base_pipeline_id?: number | null;
    base_status_id?: number | null;
  }> = [];

  for (let i = 0; i < Math.min(ids.length, limit); i++) {
    const id = ids[i];
    const raw = await kvGet<any>(KEY(id)).catch(() => null);
    const exists = !!raw;
    let name: string | null = null;
    let base_pipeline_id: number | null = null;
    let base_status_id: number | null = null;

    if (raw) {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      name = obj?.name ?? null;
      base_pipeline_id = typeof obj?.base_pipeline_id === 'number' ? obj.base_pipeline_id : null;
      base_status_id = typeof obj?.base_status_id === 'number' ? obj.base_status_id : null;
    }

    sample.push({ id, exists, name, base_pipeline_id, base_status_id });
  }

  return NextResponse.json({
    ok: true,
    auth_detected: authed,
    index_count: ids.length,
    sample_limit: limit,
    sample,
    tips: [
      'GET /api/campaigns?pass=11111 — повний список (для UI).',
      'POST /api/campaigns з Bearer — створення/оновлення кампанії.',
      'Якщо sample показує exists=false — ключа campaigns:{id} нема, варто прогнати /api/admin/campaigns/repair.',
    ],
  });
}
