// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';

const INDEX_KEY = 'campaigns:index:list';            // використовуємо LIST замість ZSET
const ITEM_KEY  = (id: string) => `campaigns:${id}`;

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Rules = { v1?: Rule; v2?: Rule };
type Campaign = {
  id?: string;
  name?: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number | string | null;
  base_status_id?: number | string | null;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: Rules;
  exp?: Record<string, any>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function ok(data: any, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true, ...data }, init);
}
function err(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getAdminToken(req: Request) {
  const fromHeader = req.headers.get('x-admin-token') || req.headers.get('X-Admin-Token');
  const fromCookie = cookies().get('admin_token')?.value;
  return fromHeader || fromCookie || '';
}
function isAdmin(req: Request) {
  const token = getAdminToken(req);
  const pass = process.env.ADMIN_PASS || '11111';
  return token && token === pass;
}

// POST /api/campaigns — створити кампанію
export async function POST(req: Request) {
  if (!isAdmin(req)) return err('Unauthorized: missing or invalid admin token', 401);

  let body: Campaign;
  try { body = await req.json(); } catch { return err('Bad JSON', 400); }

  const now = Date.now();
  const id = String(now);

  const item: Campaign = {
    name: body.name || 'Campaign',
    created_at: now,
    active: true,
    base_pipeline_id: body.base_pipeline_id ?? null,
    base_status_id: body.base_status_id ?? null,
    base_pipeline_name: body.base_pipeline_name ?? null,
    base_status_name: body.base_status_name ?? null,
    rules: {
      v1: { op: body.rules?.v1?.op || 'contains', value: body.rules?.v1?.value || '' },
      v2: { op: body.rules?.v2?.op || 'contains', value: body.rules?.v2?.value || '' },
    },
    exp: body.exp || {},
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // 1) зберегти сам об’єкт
  const setRes = await redis.set(ITEM_KEY(id), JSON.stringify(item));
  // 2) додати id в індекс-список (нові — зверху)
  const pushRes = await redis.lpush(INDEX_KEY, id);

  return ok({ id, setRes, pushRes, item });
}

// GET /api/campaigns — список кампаній
export async function GET() {
  let ids: string[] = [];
  try {
    ids = (await redis.lrange(INDEX_KEY, 0, -1)) as string[];
  } catch (e: any) {
    return err('KV lrange failed', 500, { detail: e?.message || String(e) });
  }

  const items: Campaign[] = [];
  for (const id of ids) {
    try {
      const raw = await redis.get(ITEM_KEY(id));
      if (!raw) continue;
      const obj = JSON.parse(raw) as Campaign;
      obj.id = id;
      items.push(obj);
    } catch {
      // пропускаємо зламані записи
    }
  }

  return ok({ count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
}
