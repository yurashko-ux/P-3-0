// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const username = (url.searchParams.get('username') || '').trim();
    const pipeline_id_q = url.searchParams.get('pipeline_id');
    const status_id_q = url.searchParams.get('status_id');
    const limit_q = url.searchParams.get('limit');

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username_required' }, { status: 400 });
    }

    const params = {
      username,
      pipeline_id: pipeline_id_q ? (Number.isFinite(Number(pipeline_id_q)) ? Number(pipeline_id_q) : pipeline_id_q) : undefined,
      status_id: status_id_q ? (Number.isFinite(Number(status_id_q)) ? Number(status_id_q) : status_id_q) : undefined,
      limit: Number.isFinite(Number(limit_q || '')) ? Number(limit_q) : undefined,
    };

    const found = await findCardIdByUsername(params);
    return NextResponse.json(found, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
