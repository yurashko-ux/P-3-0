// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// ---------- Upstash REST helpers (без lib/redis) ----------
const URL = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;
function okKV() { return !!URL && !!TOKEN; }

async function kvGET<T = string | null>(key: string): Promise<T | null> {
  const r = await fetch(`${URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  return (j?.result ?? null) as any;
}

async function kvSET(key: string, val: any): Promise<boolean> {
  const value = typeof val === 'string' ? val : JSON.stringify(val);
  const r = await fetch(
    `${URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
    }
  );
  const j = await r.json().catch(() => ({}));
  return j?.result === 'OK';
}

async function kvLPUSH(key: string, ...values: string[]): Promise<number> {
  const r = await fetch(`${URL}/lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(values),
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  // Upstash повертає {result: <new length>}
  return Number(j?.result ?? 0);
}

async function kvLRANGE(
  key: string,
  start = 0,
  stop = -1
): Promise<string[]> {
  const r = await fetch(
    `${URL}/lrange/${encodeURIComponent(key)}/${start}/${stop}`,
    {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
    }
  );
  const j = await r.json().catch(() => ({}));
  return (j?.result ?? []) as string[];
}

// ---------- Ключі та утиліти ----------
const INDEX_KEY = 'campaigns:index:list'; // LPUSH нові зверху
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

function isAdmin(): boolean {
  const c = cookies();
  const cookieToken =
    c.get('admin_token')?.value ||
    c.get('admin_pass')?.value ||
    c.get('ADMIN_TOKEN')?.value ||
    c.get('ADMIN_PASS')?.value ||
    '';
  const envToken = process.env.ADMIN_TOKEN || process.env.ADMIN_PASS || '';
  if (envToken) return !!cookieToken && cookieToken === envToken;
  return true; // dev режим, якщо токен не задано в env
}

// ---------- GET: список кампаній ----------
export async function GET() {
  try {
    if (!isAdmin()) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: missing or invalid admin token' },
        { status: 401 }
      );
    }
    if (!okKV()) {
      return NextResponse.json(
        { ok: false, error: 'KV not configured (KV_REST_API_URL/TOKEN)' },
        { status: 500 }
      );
    }

    const ids = await kvLRANGE(INDEX_KEY, 0, -1);

    const items: any[] = [];
    for (const id of ids) {
      const raw = await kvGET<string>(ITEM_KEY(id));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        items.push({
          id,
          name: obj?.name ?? '',
          created_at: obj?.created_at ?? Date.now(),
          active: obj?.active ?? true,

          base_pipeline_id: obj?.base_pipeline_id ?? obj?.pipeline_id ?? null,
          base_status_id: obj?.base_status_id ?? obj?.status_id ?? null,
          base_pipeline_name: obj?.base_pipeline_name ?? null,
          base_status_name: obj?.base_status_name ?? null,

          rules: obj?.rules ?? {},
          exp: obj?.exp ?? {},

          v1_count: obj?.v1_count ?? 0,
          v2_count: obj?.v2_count ?? 0,
          exp_count: obj?.exp_count ?? 0,
        });
      } catch {}
    }

    return NextResponse.json(
      { ok: true, count: items.length, items },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}

// ---------- POST: створення кампанії ----------
export async function POST(req: Request) {
  try {
    if (!isAdmin()) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: missing or invalid admin token' },
        { status: 401 }
      );
    }
    if (!okKV()) {
      return NextResponse.json(
        { ok: false, error: 'KV not configured (KV_REST_API_URL/TOKEN)' },
        { status: 500 }
      );
    }

    const now = Date.now();
    const body = await req.json().catch(() => ({} as any));
    const name = String(body?.name || '').trim();
    if (!name) {
      return NextResponse.json(
        { ok: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    const item = {
      name,
      created_at: now,
      active: body?.active ?? true,

      base_pipeline_id: body?.base_pipeline_id ?? body?.pipeline_id ?? null,
      base_status_id: body?.base_status_id ?? body?.status_id ?? null,
      base_pipeline_name: body?.base_pipeline_name ?? null,
      base_status_name: body?.base_status_name ?? null,

      rules: {
        v1: body?.rules?.v1 ?? { op: 'contains', value: '' },
        v2: body?.rules?.v2 ?? { op: 'contains', value: '' },
      },

      exp: body?.exp ?? {},

      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    const id = `${now}`;

    // зберегти та проіндексувати
    const ok1 = await kvSET(ITEM_KEY(id), item);
    await kvLPUSH(INDEX_KEY, id);

    return NextResponse.json(
      { ok: ok1, id, item },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}
