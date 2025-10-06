// web/lib/keycrm-move.ts
// Shared helpers for moving KeyCRM cards between pipelines/statuses.

export type MoveBody = {
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
  error?: string;
  need?: { KEYCRM_API_TOKEN: boolean; KEYCRM_BASE_URL: boolean };
};

type MoveConfig = { baseUrl: string; token: string };

type MissingConfig = { need: { KEYCRM_API_TOKEN: boolean; KEYCRM_BASE_URL: boolean } };

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function getKeycrmMoveConfig(): MoveConfig | MissingConfig {
  const rawBase = process.env.KEYCRM_BASE_URL || '';
  const token = process.env.KEYCRM_API_TOKEN || '';
  const baseUrl = rawBase.replace(/\/+$/, '');

  if (!baseUrl || !token) {
    return {
      need: {
        KEYCRM_API_TOKEN: Boolean(token),
        KEYCRM_BASE_URL: Boolean(baseUrl),
      },
    };
  }

  return { baseUrl, token };
}

/**
 * Деякі інсталяції KeyCRM мають різні шляхи для move:
 * - POST /cards/{card_id}/move            body: { pipeline_id, status_id }
 * - POST /pipelines/cards/move            body: { card_id, pipeline_id, status_id }
 * Ми спробуємо обидва варіанти (у такому порядку), і повернемо перший успішний.
 */
export async function tryMove(
  baseUrl: string,
  token: string,
  body: MoveBody
): Promise<MoveAttemptResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const attempts = [
    {
      url: join(baseUrl, `/cards/${encodeURIComponent(body.card_id)}/move`),
      payload: {
        pipeline_id: body.to_pipeline_id,
        status_id: body.to_status_id,
      },
      name: 'cards/{id}/move',
    },
    {
      url: join(baseUrl, `/pipelines/cards/move`),
      payload: {
        card_id: body.card_id,
        pipeline_id: body.to_pipeline_id,
        status_id: body.to_status_id,
      },
      name: 'pipelines/cards/move',
    },
  ];

  let last: MoveAttemptResult = {
    ok: false,
    attempt: '',
    status: 0,
    text: '',
  };

  for (const a of attempts) {
    try {
      const r = await fetch(a.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(a.payload),
        cache: 'no-store',
      });

      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch {}

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

export async function moveCard(
  body: MoveBody,
  config?: MoveConfig
): Promise<MoveAttemptResult> {
  const cfg = config ?? getKeycrmMoveConfig();
  if (!('baseUrl' in cfg)) {
    return {
      ok: false,
      attempt: 'config',
      status: 0,
      text: 'missing keycrm config',
      error: 'keycrm_not_configured',
      need: cfg.need,
    };
  }

  return tryMove(cfg.baseUrl, cfg.token, body);
}
