// web/lib/keycrm-move.ts

export type MoveBody = {
  card_id: string;
  to_pipeline_id: string | null;
  to_status_id: string | null;
};

type MoveAttempt = {
  url: string;
  payload: Record<string, unknown>;
  name: string;
};

export type MoveResponse = {
  ok: boolean;
  attempt: string;
  status: number;
  text: string;
  json?: any;
};

export type ReadyConfig = {
  ok: true;
  baseUrl: string;
  token: string;
};

export type MissingConfig = {
  ok: false;
  need: {
    KEYCRM_API_TOKEN: boolean;
    KEYCRM_API_URL: boolean;
    KEYCRM_BASE_URL: boolean;
  };
};

const join = (base: string, path: string) => {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
};

export function getKeycrmMoveConfig(): ReadyConfig | MissingConfig {
  const rawApiUrl = (process.env.KEYCRM_API_URL || "").trim();
  const rawBaseUrl = (process.env.KEYCRM_BASE_URL || "").trim();
  const token = (process.env.KEYCRM_API_TOKEN || "").trim();

  const baseCandidate = rawApiUrl || rawBaseUrl;
  const baseUrl = baseCandidate.replace(/\/+$/, "");

  if (!token || !baseCandidate) {
    return {
      ok: false,
      need: {
        KEYCRM_API_TOKEN: Boolean(token),
        KEYCRM_API_URL: Boolean(rawApiUrl),
        KEYCRM_BASE_URL: Boolean(rawBaseUrl),
      },
    };
  }

  return { ok: true, baseUrl, token };
}

async function callKeycrm(attempt: MoveAttempt, token: string): Promise<MoveResponse> {
  try {
    const response = await fetch(attempt.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(attempt.payload),
      cache: "no-store",
    });

    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}

    const success = response.ok && (json == null || json.ok === undefined || json.ok === true);
    return {
      ok: success,
      attempt: attempt.name,
      status: response.status,
      text,
      json: json ?? undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      attempt: attempt.name,
      status: 0,
      text: String(error),
    };
  }
}

export async function moveCard(config: ReadyConfig, body: MoveBody): Promise<MoveResponse> {
  const attempts: MoveAttempt[] = [
    {
      url: join(config.baseUrl, `/cards/${encodeURIComponent(body.card_id)}/move`),
      payload: {
        pipeline_id: body.to_pipeline_id,
        status_id: body.to_status_id,
      },
      name: "cards/{id}/move",
    },
    {
      url: join(config.baseUrl, "/pipelines/cards/move"),
      payload: {
        card_id: body.card_id,
        pipeline_id: body.to_pipeline_id,
        status_id: body.to_status_id,
      },
      name: "pipelines/cards/move",
    },
  ];

  let last: MoveResponse = {
    ok: false,
    attempt: "",
    status: 0,
    text: "",
  };

  for (const attempt of attempts) {
    const result = await callKeycrm(attempt, config.token);
    if (result.ok) return result;
    last = result;
  }

  return last;
}
