import { NextResponse } from 'next/server';
import { moveCard } from '../../../../../lib/keycrm';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { card_id, to_pipeline_id, to_status_id } = body;

  if (!card_id || !to_pipeline_id || !to_status_id) {
    return NextResponse.json(
      { ok: false, error: 'missing fields' },
      { status: 400 }
    );
  }

  try {
    const data = await moveCard(
      String(card_id),
      String(to_pipeline_id),
      String(to_status_id)
    );
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
