// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';

const LIST_KEY  = 'campaigns:list';   // список id (LPUSH / LRANGE)
const ITEMS_KEY = 'campaigns:items';  // список JSON-ів (LPUSH / LRANGE)
const ITEM_KEY  = (id: string) => `campaign:${id}`;

function pickAdminToken(req: Request): string {
  const url = new URL(req.url);
  const fromHeader = req.headers.get('x-admin-token') || '';
  const fromCookie = cookies().get('admin_token')?.value || '';
  const fromQuery  = url.searchParams.get('token') || '';
  return fromHeader || fromCookie || fromQuery || '';
}

function isAuthorized(token: string): boolean {
  const pass = process.env.ADMIN_PASS || '11111';
  return token && token === pass;
}

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Campaign = {
  id?: string;
  name?: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: {
    v1?: Rule;
    v2?: Rule;
  };
  exp?: Record<string, unknown>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

export async function GET() {
  try {
    // читаємо останні елементи зі списку JSON-ів
    const raws = await redis.lrange(ITEMS_KEY, 0, -1).catch(() => []);
    const items: Campaign[] = (raws || [])
      .map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Campaign[];

    return NextResponse.json({ ok: true, count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'KV lrange failed', detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // ✅ приймаємо токен з заголовка, cookie або query
  const token = pickAdminToken(req);
  if (!isAuthorized(token)) {
    return new NextResponse('Unauthorized: missing or invalid admin token', { status: 401 });
  }

  let body: Campaign = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // мінімальна валідація
  const name = (body.name || '').trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: 'Field "name" is required' }, { status: 400 });
  }

  const now = Date.now();
  const id = String(now);

  const item: Campaign = {
    id,
    name,
    created_at: now,
    active: body.active ?? true,

    base_pipeline_id: body.base_pipeline_id ?? null,
    base_status_id: body.base_status_id ?? null,
    base_pipeline_name: body.base_pipeline_name ?? null,
    base_status_name: body.base_status_name ?? null,

    rules: {
      v1: {
        op: body.rules?.v1?.op ?? 'contains',
        value: body.rules?.v1?.value ?? '',
      },
      v2: {
        op: body.rules?.v2?.op ?? 'contains',
        value: body.rules?.v2?.value ?? '',
      },
    },

    exp: body.exp ?? {},

    v1_count: body.v1_count ?? 0,
    v2_count: body.v2_count ?? 0,
    exp_count: body.exp_count ?? 0,
  };

  try {
    // 1) окремий ключ (для можливого прямого читання)
    await redis.set(ITEM_KEY(id), JSON.stringify(item));

    // 2) підтримуємо два простих списки (без sorted set):
    //    - список id (може знадобитися надалі)
    await redis.lpush(LIST_KEY, id);
    //    - список самих JSON-ів для швидкого GET /api/campaigns
    await redis.lpush(ITEMS_KEY, JSON.stringify(item));

    return NextResponse.json(
      { ok: true, id, item },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'KV write failed', detail: String(e?.message || e) },
      { status: 500 },
    );
  }
}
