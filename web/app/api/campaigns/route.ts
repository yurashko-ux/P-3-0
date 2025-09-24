// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// Ключі в KV (лист індексів + окремі items)
const INDEX_KEY = 'campaigns:index:list';
const ITEM_KEY = (id: string | number) => `campaigns:item:${id}`;

// Допоміжне читання JSON із безпечним парсом
async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function unauthorized(msg = 'Unauthorized: missing or invalid admin token') {
  return NextResponse.json({ ok: false, error: msg }, { status: 401 });
}

function badRequest(msg: string, detail?: unknown) {
  return NextResponse.json({ ok: false, error: msg, detail }, { status: 400 });
}

function serverError(msg: string, detail?: unknown) {
  return NextResponse.json({ ok: false, error: msg, detail }, { status: 500 });
}

// GET /api/campaigns — повертає список кампаній у порядку додавання (новіші зверху)
export async function GET() {
  try {
    // Читаємо всі id з LIST
    const ids = (await redis.lrange(INDEX_KEY, 0, -1).catch(() => [])) as string[];

    if (!ids || ids.length === 0) {
      return NextResponse.json({ ok: true, count: 0, items: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Тягнемо кожен item по ключу
    const items: any[] = [];
    for (const id of ids) {
      const raw = await redis.get(ITEM_KEY(id)).catch(() => null);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        // захист від битих записів
        if (parsed && typeof parsed === 'object') items.push({ id, ...parsed });
      } catch {
        // ігноруємо биті json
      }
    }

    return NextResponse.json(
      { ok: true, count: items.length, items },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return serverError('KV list read failed', e?.message || String(e));
  }
}

// POST /api/campaigns — створює кампанію
export async function POST(req: Request) {
  // Перевірка адмін-токена в заголовку
  const headerToken = req.headers.get('x-admin-token') || '';
  const envToken = process.env.ADMIN_PASS || '';
  if (!envToken || headerToken !== envToken) {
    return unauthorized();
  }

  type Rule = { op?: 'contains' | 'equals'; value?: string };
  type Body = {
    name?: string;
    base_pipeline_id?: number | string;
    base_status_id?: number | string;
    rules?: { v1?: Rule; v2?: Rule };
    exp?: Record<string, unknown>;
    active?: boolean;
  };

  let body: Body;
  try {
    body = await readJson<Body>(req);
  } catch (e: any) {
    return badRequest('Invalid JSON body', e?.message || String(e));
  }

  const name = String(body?.name || '').trim();
  if (!name) return badRequest('Field "name" is required');

  // Примусово числа для pipeline/status
  const base_pipeline_id = Number(body?.base_pipeline_id ?? 0) || 0;
  const base_status_id = Number(body?.base_status_id ?? 0) || 0;

  // Нормалізація правил
  const rules = {
    v1: {
      op: (body?.rules?.v1?.op === 'equals' ? 'equals' : 'contains') as 'contains' | 'equals',
      value: String(body?.rules?.v1?.value ?? ''),
    },
    v2: {
      op: (body?.rules?.v2?.op === 'equals' ? 'equals' : 'contains') as 'contains' | 'equals',
      value: String(body?.rules?.v2?.value ?? ''),
    },
  };

  const now = Date.now();
  const id = String(now);

  const item = {
    name,
    created_at: now,
    active: body?.active ?? true,

    base_pipeline_id,
    base_status_id,
    base_pipeline_name: null as string | null,
    base_status_name: null as string | null,

    rules,
    exp: body?.exp ?? {},

    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  try {
    // 1) зберегти сам об’єкт
    const setRes = await redis.set(ITEM_KEY(id), JSON.stringify(item));

    // 2) додати id у початок списку (нові зверху)
    // Якщо хочеш знизу — поміняй на rpush
    const pushRes = await redis.lpush(INDEX_KEY, id);

    return NextResponse.json(
      { ok: true, id, setRes: { result: setRes }, pushRes: { result: pushRes }, item },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return serverError('KV write failed', e?.message || String(e));
  }
}
