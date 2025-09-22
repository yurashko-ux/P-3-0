// web/app/api/campaigns/activate/route.ts
// Toggle активність кампанії: POST /api/campaigns/activate?id=<uuid>&on=true|false
// Захищено простим адмін-токеном (assertAdmin: Bearer 11111 або ?pass=11111).

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { assertAdmin } from '@/lib/auth';
import type { Campaign } from '@/lib/types';

export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

function parseOn(v: string | null): boolean {
  if (!v) return true;
  const s = v.toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export async function POST(req: Request) {
  try {
    await assertAdmin(req);

    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const on = parseOn(url.searchParams.get('on'));

    if (!id) {
      return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 });
    }

    const raw = await redis.get(ITEM_KEY(id));
    if (!raw) {
      return NextResponse.json({ ok: false, error: 'campaign not found', id }, { status: 404 });
    }

    let item: Campaign;
    try {
      item = JSON.parse(raw) as Campaign;
    } catch {
      return NextResponse.json({ ok: false, error: 'corrupted campaign JSON', id }, { status: 500 });
    }

    // оновлюємо тільки прапорець active
    const updated: Campaign = { ...item, active: on };

    await redis.set(ITEM_KEY(id), JSON.stringify(updated));

    // (не обов’язково, але освіжимо індексний timestamp якщо треба сортувати вище)
    const now = Date.now();
    await redis.zadd(INDEX_KEY, { score: now, member: id }).catch(() => { /* in-memory impl may ignore */ });

    return NextResponse.json({
      ok: true,
      id,
      active: updated.active,
      updated_at: now,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
