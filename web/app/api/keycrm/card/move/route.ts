// web/app/api/keycrm/card/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getKeycrmMoveConfig, moveCard } from '@/lib/keycrm-move';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type MoveBody = {
  card_id: string;
  to_pipeline_id: string | null;
  to_status_id: string | null;
};

function bad(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(req: NextRequest) {
  const cfg = getKeycrmMoveConfig();
  if (!('baseUrl' in cfg)) {
    return bad(500, 'keycrm not configured', { need: cfg.need });
  }

  const b = (await req.json().catch(() => ({}))) as Partial<MoveBody>;
  const card_id = String(b.card_id || '').trim();
  const to_pipeline_id = b.to_pipeline_id != null ? String(b.to_pipeline_id) : null;
  const to_status_id = b.to_status_id != null ? String(b.to_status_id) : null;

  if (!card_id) return bad(400, 'card_id required');

  // dry-run для швидкої діагностики (не викликає KeyCRM)
  const dry = new URL(req.url).searchParams.get('dry');
  if (dry === '1') {
    return ok({ dry: true, card_id, to_pipeline_id, to_status_id });
  }

  const res = await moveCard({ card_id, to_pipeline_id, to_status_id }, cfg);

  if (!res.ok) {
    return bad(502, 'keycrm move failed', {
      attempt: res.attempt,
      status: res.status,
      responseText: res.text,
      responseJson: res.json ?? null,
      sent: { card_id, to_pipeline_id, to_status_id },
      base: cfg.baseUrl.replace(/.{20}$/, '********'), // трохи маскуємо
    });
  }

  return ok({
    moved: true,
    via: res.attempt,
    status: res.status,
    response: res.json ?? res.text,
  });
}
