import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { unwrapDeep, normalizeId } from '@/lib/normalize';

export const runtime = 'nodejs';
const KEY = 'cmp:list:items';

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    const target = normalizeId(id);
    if (!target) {
      return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
    }

    const raw = await kv.get(KEY);
    const list = unwrapDeep<any[]>(raw) || [];
    const updated = list.map((x) =>
      normalizeId(x?.id) === target ? { ...x, deleted: true } : x
    );

    await kv.set(KEY, updated);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Delete error' },
      { status: 500 }
    );
  }
}
