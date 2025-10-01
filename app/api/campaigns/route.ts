// /app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { kvListIds, kvGetItem } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const ids = await kvListIds();
    const items = await Promise.all(
      ids.map(async (id) => {
        const item = await kvGetItem<any>(id);
        if (!item) return null;
        return { id, ...item };
      })
    );
    const filtered = items.filter(Boolean);
    return NextResponse.json({ ok: true, items: filtered });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
