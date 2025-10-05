// web/app/api/keycrm/card/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getKeycrmMoveConfig, moveCard, type MoveBody } from '@/lib/keycrm-move';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function bad(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}
function ok(data: any = {}) {
  return NextResponse.json({ ok: true, ...data });
}

/**
 * Деякі інсталяції KeyCRM мають різні шляхи для move:
 * - POST /cards/{card_id}/move            body: { pipeline_id, status_id }
 * - POST /pipelines/cards/move            body: { card_id, pipeline_id, status_id }
 * Ми спробуємо обидва варіанти (у такому порядку), і повернемо перший успішний.
 */
export async function POST(req: NextRequest) {
  const config = getKeycrmMoveConfig();
  if (!config.ok) {
    return bad(500, 'keycrm not configured', { need: config.need });
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

  const res = await moveCard(config, { card_id, to_pipeline_id, to_status_id });

  if (!res.ok) {
    return bad(502, 'keycrm move failed', {
      attempt: res.attempt,
      status: res.status,
      responseText: res.text,
      responseJson: res.json ?? null,
      sent: { card_id, to_pipeline_id, to_status_id },
      base: config.baseUrl.replace(/.{20}$/, '********'), // трохи маскуємо
    });
  }

  return ok({
    moved: true,
    via: res.attempt,
    status: res.status,
    response: res.json ?? res.text,
  });
}
