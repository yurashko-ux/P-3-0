// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** ===== Upstash REST (KV) ===== */
const URL = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;
const hasKV = () => Boolean(URL && TOKEN);

async function kv(path: string, init?: RequestInit) {
  const r = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`REST_ERROR ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

/** ===== Keys ===== */
const INDEX_KEY = 'campaigns:index:list';
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

/** ===== Auth (для POST/DELETE/PUT) ===== */
const ADMIN_PASS = process.env.ADMIN_PASS || '';
function readAdminToken(req: Request): string | null {
  // 1) X-Admin-Token
  const h = req.headers.get('x-admin-token');
  if (h) return h;
  // 2) Authorization: Bearer <token>
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  // 3) cookie admin_token=<token>
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}
function assertAdmin(req: Request) {
  if (!ADMIN_PASS) throw new Error('Admin auth not configured');
  const token = readAdminToken(req);
  if (!token || token !== ADMIN_PASS) {
    const err = new Error('Unauthorized: missing or invalid admin token');
    // @ts-ignore add status
    (err as any).status = 401;
    throw err;
  }
}

/** ===== Helpers ===== */
function normalizeIndex(raw: any): string[] {
  const list: string[] = Array.isArray(raw?.result) ? raw.result : [];
  return list.map((v) => {
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string') {
          return parsed[0];
        }
      } catch { /* ignore */ }
      return v;
    }
    return String(v);
  });
}

/** ===== GET: список кампаній ===== */
export async function GET() {
  try {
    if (!hasKV()) {
      return NextResponse.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const rawIdx = await kv(`/lrange/${encodeURIComponent(INDEX_KEY)}/0/-1`);
    const index = normalizeIndex(rawIdx);

    const items = await Promise.all(
      index.map(async (id) => {
        const res = await kv(`/get/${encodeURIComponent(ITEM_KEY(id))}`).catch(() => ({ result: null }));
        const raw = res?.result as string | null;
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return { id, ...parsed };
        } catch { return null; }
      })
    );

    const list = items.filter(Boolean) as Array<{ id: string; created_at?: number } & Record<string, any>>;
    list.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

    return NextResponse.json(
      { ok: true, count: list.length, items: list },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    const status = err?.status ?? 500;
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/** ===== POST: створення кампанії =====
 * очікує JSON-пейлоад (мінімум name, base_pipeline_id, base_status_id, rules)
 * авторизація: X-Admin-Token / Authorization: Bearer / cookie admin_token
 */
export async function POST(req: Request) {
  try {
    assertAdmin(req);
    if (!hasKV()) {
      return NextResponse.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const now = Date.now();
    const id = String(now);

    // Базовий shape + дефолти, щоб UI не ламався
    const item = {
      name: body.name ?? 'New campaign',
      created_at: now,
      active: Boolean(body.active ?? true),

      base_pipeline_id: body.base_pipeline_id ?? null,
      base_status_id: body.base_status_id ?? null,
      base_pipeline_name: body.base_pipeline_name ?? null,
      base_status_name: body.base_status_name ?? null,

      rules: {
        v1: { op: body?.rules?.v1?.op ?? 'contains', value: body?.rules?.v1?.value ?? '' },
        v2: { op: body?.rules?.v2?.op ?? 'contains', value: body?.rules?.v2?.value ?? '' },
      },

      exp: body.exp ?? {},

      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    // 1) записуємо сам об’єкт
    await kv(`/set/${encodeURIComponent(ITEM_KEY(id))}`, {
      method: 'POST',
      body: JSON.stringify({ value: JSON.stringify(item) }),
    });

    // 2) додаємо id у початок індексу (щоб нові зверху)
    await kv(`/lpush/${encodeURIComponent(INDEX_KEY)}`, {
      method: 'POST',
      body: JSON.stringify({ element: id }),
    });

    return NextResponse.json(
      { ok: true, id, item },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    const status = err?.status ?? 500;
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
