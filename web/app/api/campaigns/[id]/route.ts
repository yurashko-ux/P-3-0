// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../../lib/redis';

type Any = Record<string, any>;

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

export async function GET(_: Request, ctx: { params: { id: string } }) {
  const id = ctx.params?.id;
  if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

  const raw = await redis.get<string>(ITEM_KEY(id));
  if (!raw) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  try {
    const item = JSON.parse(raw);
    return NextResponse.json({ ok: true, item });
  } catch {
    return NextResponse.json({ ok: false, error: 'CORRUPTED_ITEM' }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params?.id;
  if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

  const raw = await redis.get<string>(ITEM_KEY(id));
  if (!raw) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  const patch = (await req.json()) as Any;
  let item: Any;
  try {
    item = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'CORRUPTED_ITEM' }, { status: 500 });
  }

  const updated = {
    ...item,
    ...patch,
    id,
    updated_at: Date.now(),
    name: (patch.name ?? item.name ?? '').toString().trim(),
  };

  await redis.set(ITEM_KEY(id), JSON.stringify(updated));
  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(_: Request, ctx: { params: { id: string } }) {
  const id = ctx.params?.id;
  if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

  // Видаляємо документ і індекс
  await redis.del(ITEM_KEY(id));
  await redis.zrem(INDEX_KEY, id);

  return NextResponse.json({ ok: true });
}

// Захист від випадкового POST у /[id]
export async function POST() {
  return NextResponse.json({ ok: false, error: 'UNSUPPORTED' }, { status: 400 });
}
