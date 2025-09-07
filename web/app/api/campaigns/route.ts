// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const runtime = 'nodejs'; // уникаємо edge-особливостей

type Campaign = {
  id: string;
  title?: string;
  source: { pipeline_id: string; status_id: string };
  target: { pipeline_id: string; status_id: string };
  expire_at?: number | null;
  created_at: number;
};

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
}
function isAdmin(req: Request) {
  const url = new URL(req.url);
  const pass = req.headers.get('x-admin-pass') ?? url.searchParams.get('pass') ?? '';
  const expected = process.env.ADMIN_PASS ?? '';
  return expected.length > 0 && pass === expected;
}

// GET /api/campaigns -> список (без кешу)
export async function GET() {
  try {
    const ids = await kv.lrange<string>('campaign:ids', 0, -1);
    const raw = await Promise.all(ids.map((id) => kv.get<Campaign>(`campaign:${id}`)));
    const items = (raw.filter(Boolean) as Campaign[]).sort((a, b) => b.created_at - a.created_at);
    return NextResponse.json({ ok: true, items, count: items.length }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

// POST /api/campaigns -> створення (адмін)
export async function POST(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const b = await req.json();

    const id = String(await kv.incr('campaign:next_id'));
    const item: Campaign = {
      id,
      title: String(b?.title ?? ''),
      source: {
        pipeline_id: String(b?.source?.pipeline_id ?? b?.pipeline_from ?? ''),
        status_id: String(b?.source?.status_id ?? b?.status_from ?? ''),
      },
      target: {
        pipeline_id: String(b?.target?.pipeline_id ?? b?.pipeline_to ?? ''),
        status_id: String(b?.target?.status_id ?? b?.status_to ?? ''),
      },
      expire_at: b?.expire_at ? Number(b?.expire_at) : null,
      created_at: Date.now(),
    };

    // уникаємо дублів і завжди кладемо зверху списку
    await kv.lrem('campaign:ids', 0, id);
    await kv.lpush('campaign:ids', id);
    await kv.set(`campaign:${id}`, item);

    return NextResponse.json({ ok: true, item }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

// DELETE /api/campaigns {id} -> видалення (адмін)
export async function DELETE(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400, headers: { 'cache-control': 'no-store' } });

    await kv.del(`campaign:${String(id)}`);
    await kv.lrem('campaign:ids', 0, String(id));

    return NextResponse.json({ ok: true, deleted: String(id) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
