// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../lib/redis';

type Any = Record<string, any>;

function genId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

export async function GET() {
  try {
    // Повертаємо всі кампанії, від нових до старих
    const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
    if (!ids || ids.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }
    const keys = ids.map(ITEM_KEY);
    const raws = await redis.mget<string[]>(...keys);
    const items = (raws || [])
      .map((raw, i) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          // якщо десь зіпсутий JSON — пропустимо елемент, але список повернемо
          return null;
        }
      })
      .filter(Boolean);
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'GET_FAILED' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Any;

    // Лояльний парсинг: приймаємо рядки/числа, обрізаємо пробіли
    const name = (body.name ?? '').toString().trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: 'NAME_REQUIRED' }, { status: 400 });
    }

    const now = Date.now();
    const id = genId();

    const item: Any = {
      id,
      name,
      // Поля логіки воронок: просто зберігаємо як прийшли (щоб не ламати фронт)
      base_pipeline_id: body.base_pipeline_id ?? null,
      base_status_id: body.base_status_id ?? null,
      v1_to_pipeline_id: body.v1_to_pipeline_id ?? null,
      v1_to_status_id: body.v1_to_status_id ?? null,
      v2_to_pipeline_id: body.v2_to_pipeline_id ?? null,
      v2_to_status_id: body.v2_to_status_id ?? null,
      // Додаткові поля (умови, прапор активності, лічильники тощо) — теж пропускаємо як є
      enabled: body.enabled ?? true,
      exp_days: body.exp_days != null ? Number(body.exp_days) : null,
      lastRun: null,
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
      // таймстемпи
      created_at: now,
      updated_at: now,
      // щоб не загубити нічого з тіла — кладемо решту поверх
      ...body,
      // але гарантуємо системні поля
      id,
      created_at: now,
      updated_at: now,
      name,
    };

    // Запис у KV + індекс
    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.zadd(INDEX_KEY, { score: now, member: id });

    return NextResponse.json({ ok: true, item });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'POST_FAILED' }, { status: 500 });
  }
}
