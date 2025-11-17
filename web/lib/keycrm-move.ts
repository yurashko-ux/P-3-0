// web/lib/keycrm-move.ts
// Спільний хелпер для переміщення карток KeyCRM з повторною перевіркою.

type MoveInput = {
  cardId: string;
  pipelineId: string | null;
  statusId: string | null;
};

export type KeycrmMoveAttempt = {
  snapshot: CardSnapshot | null;
  pipelineMatches: boolean;
  statusMatches: boolean;
};

export type KeycrmMoveResult = {
  ok: boolean;
  status: number;
  response: unknown;
  sent: Record<string, unknown>;
  attempts: KeycrmMoveAttempt[];
};

type CardSnapshot = {
  pipelineId: string | null;
  statusId: string | null;
  raw: unknown;
};

const join = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const normalizeId = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
};

const toKeycrmValue = (id: string) => {
  const asNumber = Number(id);
  return Number.isFinite(asNumber) ? asNumber : id;
};

const extractSnapshot = (json: any): CardSnapshot => {
  const data = Array.isArray(json?.data)
    ? json?.data[0]
    : json?.data ?? (Array.isArray(json) ? json[0] : json);

  const attributes =
    data && typeof data === 'object' && 'attributes' in (data as any)
      ? (data as any).attributes
      : data;

  const relationships =
    data && typeof data === 'object' && 'relationships' in (data as any)
      ? (data as any).relationships
      : undefined;

  const pipelineId =
    normalizeId((attributes as any)?.pipeline_id) ??
    normalizeId((attributes as any)?.pipelineId) ??
    normalizeId((attributes as any)?.pipeline?.id) ??
    normalizeId((data as any)?.pipeline_id) ??
    normalizeId((data as any)?.pipelineId) ??
    normalizeId((data as any)?.pipeline?.id) ??
    normalizeId((relationships as any)?.pipeline?.data?.id) ??
    normalizeId((relationships as any)?.pipelines?.data?.id);

  const statusId =
    normalizeId((attributes as any)?.status_id) ??
    normalizeId((attributes as any)?.statusId) ??
    normalizeId((attributes as any)?.status?.id) ??
    normalizeId((data as any)?.status_id) ??
    normalizeId((data as any)?.statusId) ??
    normalizeId((data as any)?.status?.id) ??
    normalizeId((relationships as any)?.status?.data?.id) ??
    normalizeId((relationships as any)?.pipeline_status?.data?.id) ??
    normalizeId((relationships as any)?.pipeline_statuses?.data?.id);

  return { pipelineId, statusId, raw: json };
};

const fetchSnapshot = async (
  base: string,
  token: string,
  cardId: string,
): Promise<CardSnapshot | null> => {
  try {
    const res = await fetch(join(base, `/pipelines/cards/${encodeURIComponent(cardId)}`), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text) return { pipelineId: null, statusId: null, raw: null };

    try {
      const json = JSON.parse(text);
      return extractSnapshot(json);
    } catch {
      return { pipelineId: null, statusId: null, raw: text };
    }
  } catch {
    return null;
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function moveKeycrmCard({
  cardId,
  pipelineId,
  statusId,
}: MoveInput): Promise<KeycrmMoveResult> {
  const token = process.env.KEYCRM_API_TOKEN || '';
  const base = process.env.KEYCRM_BASE_URL || '';

  if (!token || !base) {
    throw Object.assign(new Error('KeyCRM credentials are missing'), {
      code: 'keycrm_not_configured',
    });
  }

  const normalisedCardId = normalizeId(cardId);
  if (!normalisedCardId) {
    throw Object.assign(new Error('card_id required'), { code: 'card_id_missing' });
  }

  const normalisedPipelineId = normalizeId(pipelineId);
  const normalisedStatusId = normalizeId(statusId);

  if (!normalisedPipelineId && !normalisedStatusId) {
    throw Object.assign(new Error('to_pipeline_id or to_status_id required'), {
      code: 'target_missing',
    });
  }

  const payload: Record<string, unknown> = {};
  if (normalisedPipelineId) {
    payload.pipeline_id = toKeycrmValue(normalisedPipelineId);
  }
  if (normalisedStatusId) {
    const statusValue = toKeycrmValue(normalisedStatusId);
    payload.pipeline_status_id = statusValue;
    payload.status_id = statusValue;
  }

  const res = await fetch(join(base, `/pipelines/cards/${encodeURIComponent(normalisedCardId)}`), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  const attempts: KeycrmMoveAttempt[] = [];

  if (res.ok) {
    const maxTries = 10;
    for (let i = 0; i < maxTries; i += 1) {
      const verification = await fetchSnapshot(base, token, normalisedCardId);
      const pipelineMatches =
        !normalisedPipelineId || verification?.pipelineId === normalisedPipelineId;
      const statusMatches = !normalisedStatusId || verification?.statusId === normalisedStatusId;

      attempts.push({
        snapshot: verification,
        pipelineMatches,
        statusMatches,
      });

      if (pipelineMatches && statusMatches) {
        break;
      }

      if (i < maxTries - 1) {
        await wait(250);
      }
    }
  }

  const success = res.ok;

  return {
    ok: success && attempts.some((attempt) => attempt.pipelineMatches && attempt.statusMatches),
    status: res.status,
    response: json,
    sent: payload,
    attempts,
  };
}

export { normalizeId };
