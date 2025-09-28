// web/app/api/keycrm/sync/diag/route.ts
// Diagnostic endpoint adapted to new KV helpers (LIST index). Replaces old kvGet/kvZRange usage.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest) {
  const header = req.headers.get('x-admin-token') || '';
  const cookie = req.cookies.get('admin_token')?.value || '';
  const token = header || cookie;
  return token && token === process.env.ADMIN_PASS;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id'); // optional: inspect a specific campaign

  try {
    const ids = await kvRead.lrange(campaignKeys.INDEX_KEY, 0, -1);

    let item: unknown = null;
    if (id) {
      const raw = await kvRead.getRaw(campaignKeys.ITEM_KEY(id));
      if (raw) {
        try { item = JSON.parse(raw); } catch { item = { parseError: true, raw }; }
      }
    }

    return NextResponse.json({
      ok: true,
      time: new Date().toISOString(),
      indexKey: campaignKeys.INDEX_KEY,
      totalIds: ids.length,
      head: ids.slice(0, 10), // preview first 10
      inspectId: id || null,
      item,
      env: {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,              // write
        KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN, // read
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'diag failed' },
      { status: 500 },
    );
  }
}
