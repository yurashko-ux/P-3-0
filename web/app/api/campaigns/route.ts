// web/app/api/campaigns/route.ts
// Уніфікований GET/POST для кампаній. Працює з web/lib/redis.ts.
// GET: повертає масив кампаній (останнє зверху).
// POST: створення/апсертування (вимагає адмін-токен через assertAdmin()).

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { assertAdmin } from '@/lib/auth';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:item:${id}`;

// Проста нормалізація мінімально потрібних полів
function normalize(input: any): any {
  const now = Date.now();
  const id = input?.id || crypto.randomUUID();

  const rules = input?.rules || {};
  const v1 = rules.v1 || { op: 'contains', value: '' };
  const v2 = rules.v2 || { op: 'contains', value: '' };

  const base_pipeline_id = Number(input?.base_pipeline_id ?? 0);
  const base_status_id = Number(input?.base_status_id ?? 0);

  const exp = input?.exp
    ? {
        days: Number(input.exp.days ?? 0),
        to_pipeline_id: Number(input.exp.to_pipeline_id ?? 0),
        to_status_id: Number(input.exp.to_status_id ?? 0),
      }
    : undefined;

  return {
    id,
    name: String(input?.name ?? 'Untitled'),
    created_at: Number(input?.created_at ?? now),
    active: Boolean(input?.active ?? false),
    base_pipeline_id,
    base_status_id,
    rules: { v1, v2 },
    exp,
    v1_count: Number(input?.v1_count ?? 0),
    v2_count: Number(input?.v2_count ?? 0),
    exp_count: Number(input?.exp_count ?? 0),

    // назви можуть бути додані бекендом пізніше — не вимагаємо тут
    base_pipeline_name: input?.base_pipeline_name ?? null,
    base_status_name: input?.base_status_name ?? null,
    exp_to_pipeline_name: input?.exp_to_pipeline_name ?? null,
    exp_to_status_name: input?.exp_to_status_name ?? null,
  };
}

export const dynamic = 'force-dynamic';

// ===== GET: список кампаній (новіші зверху) =====
export async function GET() {
  try {
    // Читаємо ВСІ id з індексу. Використовуємо індексне ZRANGE (0..-1) + REV.
    const ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];

    if (!ids || ids.length === 0) {
      return NextResponse.json({ ok: true, items: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Батчимо MGET по ключам items
    const keys = ids.map(ITEM_KEY);
    const raws = (await redis.mget(...keys)) as (string | null)[];
    const items = raws
      .map((raw) => {
        if (!raw) return null;
        try {
          return normalize(JSON.parse(raw));
        } catch {
          // Якщо лежить plain-string — обгортаємо мінімально
          return normalize({ name: String(raw) });
        }
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

// ===== POST: створити/апдейтнути кампанію =====
export async function POST(req: Request) {
  try {
    await assertAdmin(req); // вимагає Bearer 11111 або ?pass=11111

    const body = await req.json().catch(() => ({}));
    const item = normalize(body);
    const { id, created_at } = item;

    // Зберегти сам об'єкт
    await redis.set(ITEM_KEY(id), JSON.stringify(item));

    // Додати до індексу за created_at
    await redis.zadd(INDEX_KEY, { score: Number(created_at), member: id });

    // Повернути короткий результат
    return NextResponse.json({ ok: true, id, item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    const status = String(e?.message || '').toLowerCase().includes('unauthorized') ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
