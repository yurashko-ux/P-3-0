// web/app/api/keycrm/card/move/route.ts
import { NextResponse } from 'next/server';
import { moveCard } from '@/lib/keycrm';

function isAdmin(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)admin_pass=([^;]+)/);
  const val = m?.[1] ? decodeURIComponent(m[1]) : '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  return !!ADMIN_PASS && val === ADMIN_PASS;
}

export async function POST(req: Request) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const card_id = String(body?.card_id || '').trim();
    const to_pipeline_id = String(body?.to_pipeline_id || '').trim();
    const to_status_id = String(body?.to_status_id || '').trim();

    if (!card_id || !to_pipeline_id || !to_status_id) {
      return NextResponse.json(
        { ok: false, error: 'missing card_id / to_pipeline_id / to_status_id' },
        { status: 400 }
      );
    }

    // Викликаємо ваш клієнт до KeyCRM
    await moveCard(card_id, to_pipeline_id, to_status_id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'move failed' },
      { status: 500 }
    );
  }
}
