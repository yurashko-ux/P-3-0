import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { unwrapDeep } from '@/lib/normalize';
import type { Campaign } from '@/lib/types';

export const runtime = 'nodejs';

const KEY = 'cmp:list:items';

export async function GET() {
  try {
    const raw = await kv.get(KEY);
    const list = unwrapDeep<any[]>(raw) || [];
    // Фільтруємо видалені
    const items: Campaign[] = list.filter((x) => !x?.deleted);
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Read error' },
      { status: 500 }
    );
  }
}
