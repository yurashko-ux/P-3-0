// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '@/lib/redis';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Rules = { v1?: Rule; v2?: Rule };
type Campaign = {
  id?: string;
  name?: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: Rules;
  exp?: Record<string, any>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ---- helpers

function ok(data: any, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true, ...data }, init);
}
function err(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getAdminToken(req: Request) {
  const hdr = req.headers.get('x-admin-token') || req.headers.get('X-Admin-Token');
  const c = cookies().get('admin_token')?.value;
  return hdr || c || '';
}
function isAdmin(req: Request) {
  const token = getAdminToken(req);
  const pass = process.env.ADMIN_PASS || '11111';
  return token && token === pass;
}

// ---- POST /api/campaigns  (create)
export async function POST(req: Request) {
  if (!isAdmin(req)) return err('Unauthorized: missing or invalid admin token', 401);

  let body: Campaign;
  try {
    body = await req.json();
  } catch {
    return err('Bad JSON', 400);
  }

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

  // save
  const setRes = await redis.set(ITEM_KEY(id), JSON.stringify(item));
  // index by created_at (score), member = id
  // our redis wrapper may support both shapes; use the safe one:
  const zaddRes = await redis.zadd(INDEX_KEY, { score: now, member: id });

  return ok({ id, setRes, zaddRes, item });
}

// ---- GET /api/campaigns  (list)
export async function GET() {
  let ids: string[] = [];
  try {
    // prefer reverse order (newest first)
    // some wrappers support options object, some don’t — handle both
    try {
      // @ts-ignore - optional signature with options
      ids = (await redis.zrange(INDEX_KEY, 0, -1, { rev: true })) as string[];
    } catch {
      ids = (await redis.zrange(INDEX_KEY, 0, -1)) as string[];
      ids = ids.reverse();
    }
  } catch (e: any) {
    return err('KV zrange failed', 500, { detail: e?.message || String(e) });
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
      // skip broken entries
    }
  }

  return ok({ count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } });
}

// ---- (optional) DELETE all campaigns — comment out in prod
// export async function DELETE(req: Request) {
//   if (!isAdmin(req)) return err('Unauthorized: missing or invalid admin token', 401);
//   // naive wipe: read ids then delete each key and clear index
//   const ids = (await redis.zrange(INDEX_KEY, 0, -1)) as string[];
//   for (const id of ids) {
//     await redis.del(ITEM_KEY(id));
//   }
//   await redis.del(INDEX_KEY);
//   return ok({ wiped: ids.length });
// }
