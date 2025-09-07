// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

type Campaign = {
  id: string;
  title?: string;
  source: { pipeline_id: string; status_id: string };
  target: { pipeline_id: string; status_id: string };
  expire_at?: number | null;
  created_at: number;
};

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

function isAdmin(req: Request) {
  const url = new URL(req.url);
  const pass = req.headers.get('x-admin-pass') ?? url.searchParams.get('pass');
  const expected = process.env.ADMIN_PASS;
  return expected && pass === expected;
}

// GET /api/campaigns  -> список
export async function GET() {
  try {
    const ids = (await kv.lrange<string>('campaign:ids', 0, -1)) ?? [];
    const itemsRaw = await Promise.all(ids.map((id) => kv.get<Campaign>(`campaign:${id}`)));
    const items = (itemsRaw.filter(Boolean) as Campaign[]).sort((a, b) => b.created_at - a.created_at);
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500 });
  }
}

// POST /api/campaigns  -> створення (адмін)
export async function POST(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const body = await req.json();

    const id = String(await kv.incr('campaign:next_id'));
    const item: Campaign = {
      id,
      title: body?.title ?? '',
      source: {
        pipeline_id: String(body?.source?.pipeline_id ?? body?.pipeline_from ?? ''),
        status_id: String(body?.source?.status_id ?? body?.status_from ?? ''),
      },
      target: {
        pipeline_id: String(body?.target?.pipeline_id ?? body?.pipeline_to ?? ''),
        status_id: String(body?.target?.status_id ?? body?.status_to ?? ''),
      },
      expire_at: body?.expire_at ? Number(body?.expire_at) : null,
      created_at: Date.now(),
    };

    await kv.set(`campaign:${id}`, item);
    await kv.lpush('campaign:ids', id);

    return NextResponse.json({ ok: true, item });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500 });
  }
}

// DELETE /api/campaigns  { id } -> видалення (адмін)
export async function DELETE(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    await kv.del(`campaign:${id}`);
    await kv.lrem('campaign:ids', 0, String(id));

    return NextResponse.json({ ok: true, deleted: String(id) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'kv error' }, { status: 500 });
  }
}
