// web/app/api/keycrm/card/move/route.ts
import { NextResponse } from 'next/server';
import { moveCard } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const card_id = body?.card_id != null ? String(body.card_id) : '';
    const to_pipeline_id = body?.to_pipeline_id != null ? String(body.to_pipeline_id) : '';
    const to_status_id = body?.to_status_id != null ? String(body.to_status_id) : '';

    if (!card_id || !to_pipeline_id || !to_status_id) {
      return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 });
    }

    const result = await moveCard(card_id, to_pipeline_id, to_status_id);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'move failed' }, { status: 500 });
  }
}
