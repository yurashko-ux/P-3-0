// web/app/api/campaigns/activate/route.ts
// Toggle active=true/false for a campaign by id.
// Body: { id: string, active?: boolean }  // if active omitted, it will be toggled
// Auth: X-Admin-Token header or admin_token cookie (must equal ADMIN_PASS)

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest) {
  const header = req.headers.get('x-admin-token') || '';
  const cookie = req.cookies.get('admin_token')?.value || '';
  const token = header || cookie;
  return !!token && token === process.env.ADMIN_PASS;
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const id = (body?.id ?? '').toString().trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 });
    }

    const itemKey = campaignKeys.ITEM_KEY(id);
    const raw = await kvRead.getRaw(itemKey);
    if (!raw) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    }

    let obj: any;
    try { obj = JSON.parse(raw); } catch {
      return NextResponse.json({ ok: false, error: 'corrupt item' }, { status: 500 });
    }

    const nextActive = typeof body.active === 'boolean' ? body.active : !(obj.active !== false);
    obj.active = nextActive;

    // persist
    await kvWrite.setRaw(itemKey, JSON.stringify(obj));

    // optional: move id to head of index to reflect recent update
    try { await kvWrite.lpush(campaignKeys.INDEX_KEY, id); } catch { /* ignore */ }

    return NextResponse.json({ ok: true, item: obj });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'toggle failed' }, { status: 500 });
  }
}
