// web/app/api/campaigns/cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

/**
 * GET — швидкий статус, що з індексом:
 *   - скільки ID в індексі
 *   - перших N (20) елементів з ознакою існування значення в KV
 */
export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = await kvZRange(INDEX, 0, -1).catch(() => []);
  ids.reverse(); // новіші зверху

  const limit = 20;
  const sample = [];
  let existCount = 0;

  for (let i = 0; i < Math.min(ids.length, limit); i++) {
    const id = ids[i];
    const raw = await kvGet(KEY(id)).catch(() => null);
    const exists = !!raw;
    if (exists) existCount++;
    sample.push({ id, exists });
  }

  return NextResponse.json({
    ok: true,
    index_count: ids.length,
    sample_limit: limit,
    sample,
    note: 'POST без параметрів поверне повний список відсутніх ключів; окреме видалення з індексу не виконуємо.',
  });
}

/**
 * POST — повна перевірка: повертає всі ID з індексу, для яких немає значення в KV.
 * Нічого не видаляє — лише звіт (щоб уникнути випадкових втрат).
 */
export async function POST(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = await kvZRange(INDEX, 0, -1).catch(() => []);
  ids.reverse();

  const missing: string[] = [];
  let present = 0;

  for (const id of ids) {
    const raw = await kvGet(KEY(id)).catch(() => null);
    if (!raw) missing.push(id);
    else present++;
  }

  return NextResponse.json({
    ok: true,
    index_count: ids.length,
    present,
    missing_count: missing.length,
    missing_ids: missing,
    hint:
      'Цей ендпойнт нічого не видаляє навмисно. Скажи, якщо потрібен окремий POST /cleanup/delete-missing — додам безпечне видалення.',
  });
}
