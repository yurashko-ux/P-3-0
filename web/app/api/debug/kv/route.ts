import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { unwrapDeep } from '@/lib/normalize';

export const runtime = 'nodejs';
const KEY = 'cmp:list:items';

export async function GET() {
  try {
    const raw = await kv.get(KEY);
    const items = unwrapDeep<any[]>(raw) || [];
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'KV read error' },
      { status: 500 }
    );
  }
}
