// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

// ===== KV (Redis-like) =====
import { redis } from '../../../lib/redis'; // шлях той самий, що й у вас
const LIST_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

const ADMIN_PASS = process.env.ADMIN_PASS || '';

// ---- helpers ----
function isAuthed(req: Request): boolean {
  // 1) cookie admin_token
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/i);
  const fromCookie = m ? decodeURIComponent(m[1]) : '';

  // 2) або заголовок X-Admin-Token
  const fromHeader = req.headers.get('x-admin-token') || '';

  const token = fromCookie || fromHeader;
  return Boolean(ADMIN_PASS && token && token === ADMIN_PASS);
}

async function readAll(): Promise<any[]> {
  // список id (LPUSH …) — нові зверху
  const ids = await redis.lrange(LIST_KEY, 0, -1).catch(() => []) as string[];
  if (!ids?.length) return [];

  const items: any[] = [];
  for (const id of ids) {
    const raw = await redis.get(ITEM_KEY(id)).catch(() => null) as string | null;
    if (!raw) continue;
    try { items.push(JSON.parse(raw)); } catch { /* ignore */ }
  }
  return items;
}

// ---- GET: ПУБЛІЧНО ----
// без перевірки токена (щоб UI міг просто отримати список)
export async function GET() {
  try {
    const items = await readAll();
    return NextResponse.json({ ok: true, count: items.length, items }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'KV read failed', detail: String(e?.message || e) }, { status: 500 });
  }
}

// ---- POST: створити (ПІД АВТЕНТИФІКАЦІЄЮ) ----
export async function POST(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = String(Date.now());
    const item = {
      id,
      name: String(body?.name || 'Campaign'),
      created_at: Date.now(),
      active: true,
      base_pipeline_id: Number(body?.base_pipeline_id ?? 0),
      base_status_id: Number(body?.base_status_id ?? 0),
      base_pipeline_name: body?.base_pipeline_name ?? null,
      base_status_name: body?.base_status_name ?? null,
      rules: body?.rules ?? {},
      exp: body?.exp ?? {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    await redis.set(ITEM_KEY(id), JSON.stringify(item));
    await redis.lpush(LIST_KEY, id);

    return NextResponse.json({ ok: true, id, item }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'KV write failed', detail: String(e?.message || e) }, { status: 500 });
  }
}

// ---- DELETE: видалити за id (ПІД АВТЕНТИФІКАЦІЄЮ) ----
export async function DELETE(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
    }

    await redis.del(ITEM_KEY(id));
    // просте «м’яке» видалення зі списку: перечитати всі, перезаписати без id
    const ids = await redis.lrange(LIST_KEY, 0, -1).catch(() => []) as string[];
    const filtered = ids.filter(x => x !== id);
    if (filtered.length !== ids.length) {
      // перезапис списку
      // спочатку видалимо ключ
      await redis.del(LIST_KEY);
      // потім запишемо заново у тій же послідовності (нові зверху — LPUSH у зворотному порядку)
      for (let i = filtered.length - 1; i >= 0; i--) {
        await redis.lpush(LIST_KEY, filtered[i]);
      }
    }

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'KV delete failed', detail: String(e?.message || e) }, { status: 500 });
  }
}
