// web/app/api/keycrm/card/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { keycrmMoveCard } from '@/lib/keycrm-move';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type MoveBody = {
  card_id?: string | number | null;
  to_pipeline_id?: string | number | null;
  to_status_id?: string | number | null;
};

function bad(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(req: NextRequest) {
  const token = process.env.KEYCRM_API_TOKEN || '';
  const base = process.env.KEYCRM_BASE_URL || ''; // напр., https://api.keycrm.app/v1
  if (!token || !base) {
    return bad(500, 'keycrm not configured', {
      need: { KEYCRM_API_TOKEN: !!token, KEYCRM_BASE_URL: !!base },
    });
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

  const res = await keycrmMoveCard({
    card_id,
    pipeline_id: to_pipeline_id,
    status_id: to_status_id,
    baseUrl: base,
    token,
  });

  if (!res.ok) {
    return bad(502, 'keycrm move failed', {
      attempt: res.details?.attempt ?? null,
      status: res.details?.status ?? null,
      responseText: res.details?.text ?? null,
      responseJson: res.details?.json ?? null,
      sent: res.sent ?? { card_id, to_pipeline_id, to_status_id },
      base: base.replace(/.{20}$/, '********'), // трохи маскуємо
    });
  }

  return ok({
    moved: true,
    via: res.via,
    status: res.status,
    response: res.response,
  });
}
