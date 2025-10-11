// web/app/api/keycrm/card/move/route.ts
import { NextRequest, NextResponse } from 'next/server';

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

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Деякі інсталяції KeyCRM мають різні шляхи для move:
 * - POST /cards/{card_id}/move            body: { pipeline_id, status_id }
 * - POST /pipelines/cards/move            body: { card_id, pipeline_id, status_id }
 * - PATCH /crm/deals/{card_id}            body: { pipeline_id, status_id }
 * Ми спробуємо їх послідовно й повернемо перший успішний.
 */
type AttemptResult = { ok: boolean; attempt: string; status: number; text: string; json?: any };

type Attempt = {
  name: string;
  url: string;
  method?: 'POST' | 'PATCH';
  payload: Record<string, unknown>;
};

async function tryMove(
  baseUrl: string,
  token: string,
  body: MoveBody
): Promise<AttemptResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Кандидати (по черзі)
  const basePayload = {
    pipeline_id: body.to_pipeline_id ?? undefined,
    status_id: body.to_status_id ?? undefined,
  } satisfies Record<string, unknown>;

  const attempts: Attempt[] = [
    {
      url: join(baseUrl, `/cards/${encodeURIComponent(body.card_id)}/move`),
      payload: basePayload,
      name: 'cards/{id}/move',
    },
    {
      url: join(baseUrl, `/pipelines/cards/move`),
      payload: {
        card_id: body.card_id,
        ...basePayload,
      },
      name: 'pipelines/cards/move',
    },
    {
      url: join(baseUrl, `/crm/deals/${encodeURIComponent(body.card_id)}`),
      method: 'PATCH',
      payload: basePayload,
      name: 'crm/deals/{id} PATCH',
    },
  ];

  let last: AttemptResult = {
    ok: false,
    attempt: '',
    status: 0,
    text: '',
  };

  for (const a of attempts) {
    try {
      const r = await fetch(a.url, {
        method: a.method ?? 'POST',
        headers,
        body: JSON.stringify(a.payload),
        cache: 'no-store',
      });

      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch {}

      // вважаємо успіхом 2xx і (якщо є) ознаку ok/true в json
      const success = r.ok && (j == null || j.ok === undefined || j.ok === true);
      if (success) {
        return { ok: true, attempt: a.name, status: r.status, text, json: j ?? undefined };
      }

      last = { ok: false, attempt: a.name, status: r.status, text, json: j ?? undefined };
    } catch (e: any) {
      last = { ok: false, attempt: a.name, status: 0, text: String(e) };
    }
  }

  return last;
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

  const res = await tryMove(base, token, { card_id, to_pipeline_id, to_status_id });

  if (!res.ok) {
    return bad(502, 'keycrm move failed', {
      attempt: res.attempt,
      status: res.status,
      responseText: res.text,
      responseJson: res.json ?? null,
      sent: { card_id, to_pipeline_id, to_status_id },
      base: base.replace(/.{20}$/, '********'), // трохи маскуємо
    });
  }

  return ok({
    moved: true,
    via: res.attempt,
    status: res.status,
    response: res.json ?? res.text,
  });
}
