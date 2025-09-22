// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { redis } from '../../../lib/redis';

export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaigns:index:list'; // список id (LPUSH → нові зверху)
const ITEM_KEY = (id: string | number) => `campaigns:${id}`;

function isAdmin(): boolean {
  const c = cookies();
  const cookieToken =
    c.get('admin_token')?.value ||
    c.get('admin_pass')?.value ||
    c.get('ADMIN_TOKEN')?.value ||
    c.get('ADMIN_PASS')?.value ||
    '';

  const envToken =
    process.env.ADMIN_TOKEN ||
    process.env.ADMIN_PASS ||
    '';

  // Якщо токен у env задано — перевіряємо збіг; якщо ні — пускаємо (dev)
  if (envToken) return !!cookieToken && cookieToken === envToken;
  return true;
}

// ===== GET /api/campaigns =====
export async function GET() {
  try {
    if (!isAdmin()) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: missing or invalid admin token' },
        { status: 401 }
      );
    }

    // читаємо індекс як список
    const ids = (await redis.lrange(INDEX_KEY, 0, -1)) as string[];

    const items: any[] = [];
    for (const id of ids || []) {
      const raw = await redis.get(ITEM_KEY(id));
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

// ===== POST /api/campaigns =====
export async function POST(req: Request) {
  try {
    if (!isAdmin()) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: missing or invalid admin token' },
        { status: 401 }
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

      base_pipeline_id:
        body?.base_pipeline_id ?? body?.pipeline_id ?? null,
      base_status_id:
        body?.base_status_id ?? body?.status_id ?? null,
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

    // 1) зберегти саму кампанію
    await redis.set(ITEM_KEY(id), JSON.stringify(item));

    // 2) додати id у початок списку-індексу
    await redis.lpush(INDEX_KEY, id);

    return NextResponse.json(
      { ok: true, id, item },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `KV error: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}
