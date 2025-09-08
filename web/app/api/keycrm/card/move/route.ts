// web/app/api/keycrm/card/move/route.ts
import { NextResponse } from 'next/server';
import { moveCard } from '@/lib/keycrm'; // використовуємо ваш клієнт до KeyCRM
import { kvLog } from '@/lib/kv';         // якщо є логер; якщо нема — можна видалити

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const card_id = body?.card_id?.toString?.();
    const to_pipeline_id = body?.to_pipeline_id?.toString?.();
    const to_status_id = body?.to_status_id?.toString?.();

    if (!card_id || !to_pipeline_id || !to_status_id) {
      return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 });
    }

    const res = await moveCard(card_id, to_pipeline_id, to_status_id);
    // опційний лог
    try { await kvLog?.('info', { source: 'api', action: 'move', card_id, to_pipeline_id, to_status_id, res }); } catch {}

    return NextResponse.json({ ok: true, result: res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'move failed' }, { status: 500 });
  }
}
