// web/lib/keycrm-move.ts
// Shared helper to move cards inside KeyCRM, trying both move endpoints.

export type MoveRequest = {
  card_id: string;
  to_pipeline_id: string | null;
  to_status_id: string | null;
};

export type MoveAttemptResult = {
  ok: boolean;
  attempt: string;
  status: number;
  text: string;
  json?: any;
};

const DEFAULT_BASE = (
  process.env.KEYCRM_BASE_URL && process.env.KEYCRM_BASE_URL.trim()
    ? process.env.KEYCRM_BASE_URL
    : 'https://openapi.keycrm.app/v1'
).replace(/\/+$/, '');
const DEFAULT_TOKEN = process.env.KEYCRM_API_TOKEN || '';

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function tryMoveOnce(
  url: string,
  payload: Record<string, any>,
  token: string,
  name: string
): Promise<MoveAttemptResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }

    const ok = res.ok && (json === undefined || json?.ok === undefined || json?.ok === true);
    if (ok) {
      return { ok: true, attempt: name, status: res.status, text, json };
    }

    return { ok: false, attempt: name, status: res.status, text, json };
  } catch (e: any) {
    return { ok: false, attempt: name, status: 0, text: String(e) };
  }
}

export async function keycrmTryMove(
  baseUrl: string,
  token: string,
  body: MoveRequest
): Promise<MoveAttemptResult> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const attempts = [
    {
      name: 'cards/{id}/move',
      url: join(cleanBase, `/cards/${encodeURIComponent(body.card_id)}/move`),
      payload: { pipeline_id: body.to_pipeline_id, status_id: body.to_status_id },
    },
    {
      name: 'pipelines/cards/move',
      url: join(cleanBase, '/pipelines/cards/move'),
      payload: { card_id: body.card_id, pipeline_id: body.to_pipeline_id, status_id: body.to_status_id },
    },
  ];

  let last: MoveAttemptResult = { ok: false, attempt: '', status: 0, text: '' };

  for (const attempt of attempts) {
    last = await tryMoveOnce(attempt.url, attempt.payload, token, attempt.name);
    if (last.ok) return last;
  }

  return last;
}

export type KeycrmMoveOptions = {
  card_id: string | number;
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
  baseUrl?: string;
  token?: string;
};

export type KeycrmMoveResult =
  | ({ ok: true; via: string; status: number; response: any })
  | ({ ok: false; error: string; details?: Omit<MoveAttemptResult, 'ok'>; need?: { token?: boolean; baseUrl?: boolean }; sent?: MoveRequest });

function toStrOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str : null;
}

export async function keycrmMoveCard(options: KeycrmMoveOptions): Promise<KeycrmMoveResult> {
  const card_id = toStrOrNull(options.card_id) || '';
  const to_pipeline_id = toStrOrNull(options.pipeline_id ?? null);
  const to_status_id = toStrOrNull(options.status_id ?? null);

  if (!card_id) {
    return { ok: false, error: 'card_id_required' };
  }

  const token = (options.token ?? DEFAULT_TOKEN).trim();
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).trim();

  if (!token) {
    return {
      ok: false,
      error: 'keycrm_not_configured',
      need: { token: true },
      sent: { card_id, to_pipeline_id, to_status_id },
    };
  }

  const attempt = await keycrmTryMove(baseUrl, token, { card_id, to_pipeline_id, to_status_id });
  if (!attempt.ok) {
    return { ok: false, error: 'move_failed', details: { attempt: attempt.attempt, status: attempt.status, text: attempt.text, json: attempt.json }, sent: { card_id, to_pipeline_id, to_status_id } };
  }

  return {
    ok: true,
    via: attempt.attempt,
    status: attempt.status,
    response: attempt.json ?? attempt.text,
  };
}
