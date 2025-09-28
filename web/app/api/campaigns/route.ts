// web/app/api/campaigns/route.ts
// Node.js runtime to avoid Edge lockdown noise and to ensure proper env/REST behavior.
// Uses kvRead/kvWrite from lib/kv with explicit read/write tokens.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest) {
  const header = req.headers.get('x-admin-token') || '';
  const cookie = req.cookies.get('admin_token')?.value || '';
  const token = header || cookie;
  return !!token && token === process.env.ADMIN_PASS;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const items = await kvRead.listCampaigns();
    return NextResponse.json({ ok: true, count: items.length, items }, { status: 200 });
  } catch (e: any) {
    console.error('GET /api/campaigns failed', e);
    return NextResponse.json({ ok: false, error: e?.message || 'KV read failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const input = {
      id: body?.id, // optional; default = Date.now()
      name: (body?.name ?? '').toString() || 'UI-created',
      active: body?.active ?? true,
      base_pipeline_id: typeof body?.base_pipeline_id === 'number' ? body.base_pipeline_id : undefined,
      base_status_id: typeof body?.base_status_id === 'number' ? body.base_status_id : undefined,
      rules: body?.rules ?? {},
      exp: body?.exp ?? {},
    };

    const saved = await kvWrite.createCampaign(input);
    return NextResponse.json({ ok: true, item: saved }, { status: 200 });
  } catch (e: any) {
    console.error('POST /api/campaigns failed', e);
    // Surface a stable error so the UI shows a meaningful message
    return NextResponse.json({ ok: false, error: e?.message || 'KV write failed' }, { status: 500 });
  }
}
