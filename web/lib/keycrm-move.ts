// web/lib/keycrm-move.ts
// Спільний хелпер для переміщення карток KeyCRM з повторною перевіркою.

import { getEnvValue } from "@/lib/env";

type MoveInput = {
  cardId: string;
  pipelineId: string | null;
  statusId: string | null;
  pipelineStatusId?: string | null;
  statusAliases?: Array<string | number | null>;
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
  sent: Record<string, unknown> | null;
  attempts: KeycrmMoveAttempt[];
  requestUrl: string | null;
  requestMethod: string | null;
};

type CardSnapshot = {
  pipelineId: string | null;
  statusId: string | null;
  raw: unknown;
};

const join = (base: string, path: string) =>
  `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

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
    normalizeId((attributes as any)?.pipeline_status_id) ??
    normalizeId((attributes as any)?.statusId) ??
    normalizeId((attributes as any)?.status?.id) ??
    normalizeId((data as any)?.status_id) ??
    normalizeId((data as any)?.pipeline_status_id) ??
    normalizeId((data as any)?.statusId) ??
    normalizeId((data as any)?.status?.id) ??
    normalizeId((relationships as any)?.status?.data?.id) ??
    normalizeId((relationships as any)?.pipeline_status?.data?.id) ??
    normalizeId((relationships as any)?.pipeline_statuses?.data?.id);

  return { pipelineId, statusId, raw: json };
};

const fetchSnapshot = async (
  base: string,
  authHeader: string,
  cardId: string,
): Promise<CardSnapshot | null> => {
  const endpoints = [
    `/pipelines/cards/${encodeURIComponent(cardId)}`,
    `/crm/deals/${encodeURIComponent(cardId)}`,
  ];

  const queryVariants = [
    "with[]=status&with[]=pipeline&include[]=status&include[]=pipeline",
    "",
  ];

  for (const endpoint of endpoints) {
    for (const query of queryVariants) {
      const path = query
        ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}`
        : endpoint;

      try {
        const res = await fetch(join(base, path), {
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (!res.ok) {
          continue;
        }

        const text = await res.text();
        if (!text) return { pipelineId: null, statusId: null, raw: null };

        try {
          const json = JSON.parse(text);
          return extractSnapshot(json);
        } catch {
          return { pipelineId: null, statusId: null, raw: text };
        }
      } catch {
        continue;
      }
    }
  }

  return null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AttemptSpec = {
  attempt: string;
  method: "POST" | "PUT" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  contentType: string;
};

export async function moveKeycrmCard({
  cardId,
  pipelineId,
  statusId,
  pipelineStatusId = null,
  statusAliases = [],
}: MoveInput): Promise<KeycrmMoveResult> {
  const baseCandidate =
    getEnvValue("KEYCRM_API_URL", "KEYCRM_API_BASE") ??
    getEnvValue("KEYCRM_BASE_URL");

  const tokenCandidate = getEnvValue("KEYCRM_API_TOKEN", "KEYCRM_TOKEN");
  const bearerCandidate = getEnvValue("KEYCRM_BEARER", "KEYCRM_API_BEARER");

  let base = baseCandidate ? baseCandidate.trim() : "";
  if (base) {
    base = base.replace(/\s+/g, "");
    base = base.replace(/\/+$/, "");

    try {
      const parsed = new URL(base);
      const normalisedPath = parsed.pathname.replace(/\/+$/, "");
      let effectivePath = normalisedPath || "";

      if (!effectivePath) {
        effectivePath = "/v1";
      } else if (!/^\//.test(effectivePath)) {
        effectivePath = `/${effectivePath}`;
      }

      base = `${parsed.origin}${effectivePath}`;
    } catch {
      const pathMatch = base.match(/(\/api\/v\d+|\/v\d+)$/i);
      if (pathMatch) {
        base = `${base.slice(0, -pathMatch[0].length)}${pathMatch[0]}`;
      } else {
        base = `${base}/v1`;
      }
    }
  }

  let authorization = "";
  if (bearerCandidate) {
    authorization = bearerCandidate.toLowerCase().startsWith("bearer ")
      ? bearerCandidate
      : `Bearer ${bearerCandidate}`;
  } else if (tokenCandidate) {
    authorization = `Bearer ${tokenCandidate}`;
  }

  if (!authorization || !base) {
    throw Object.assign(new Error("KeyCRM credentials are missing"), {
      code: "keycrm_not_configured",
      details: {
        base: Boolean(baseCandidate),
        token: Boolean(tokenCandidate || bearerCandidate),
      },
    });
  }

  const normalisedCardId = normalizeId(cardId);
  if (!normalisedCardId) {
    throw Object.assign(new Error('card_id required'), { code: 'card_id_missing' });
  }

  const normalisedPipelineId = normalizeId(pipelineId);
  const normalisedStatusId = normalizeId(statusId);
  const normalisedPipelineStatusId = normalizeId(pipelineStatusId);

  const normalisedStatusAliases = Array.isArray(statusAliases)
    ? Array.from(
        new Set(
          [
            normalisedPipelineStatusId,
            ...statusAliases.map((value) => normalizeId(value)),
          ]
            .filter((value): value is string => Boolean(value)),
        ),
      )
    : [];

  if (!normalisedPipelineId && !normalisedStatusId) {
    throw Object.assign(new Error('to_pipeline_id or to_status_id required'), {
      code: 'target_missing',
    });
  }

  const pipelineValue = normalisedPipelineId
    ? toKeycrmValue(normalisedPipelineId)
    : undefined;
  const pipelineStatusValue = normalisedPipelineStatusId
    ? toKeycrmValue(normalisedPipelineStatusId)
    : undefined;
  const statusValue = normalisedStatusId ? toKeycrmValue(normalisedStatusId) : undefined;
  const statusAliasValue = normalisedStatusAliases.find((alias) => alias !== normalisedStatusId);
  const statusValueAlias =
    statusAliasValue != null ? toKeycrmValue(statusAliasValue) : undefined;
  const cardValue = toKeycrmValue(normalisedCardId);

  const attemptHistory: Array<{
    attempt: string;
    status: number;
    ok: boolean;
    body: unknown;
    sent: Record<string, unknown>;
    verification: KeycrmMoveAttempt[];
    url: string;
    method: AttemptSpec['method'];
    error?: string;
  }> = [];

  const performAttempt = async (
    spec: AttemptSpec,
  ): Promise<{
    ok: boolean;
    status: number;
    body: unknown;
    sent: Record<string, unknown>;
    verification: KeycrmMoveAttempt[];
    url: string;
    method: AttemptSpec['method'];
  }> => {
    const url = join(base, spec.path);

    const res = await fetch(url, {
      method: spec.method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": spec.contentType,
      },
      body: JSON.stringify(spec.body),
      cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    const verificationAttempts: KeycrmMoveAttempt[] = [];

    if (res.ok) {
      const maxTries = 20;
      for (let i = 0; i < maxTries; i += 1) {
        if (i === 0) {
          await wait(300);
        } else {
          await wait(500);
        }

        const verification = await fetchSnapshot(base, authorization, normalisedCardId);
        const pipelineMatches =
          !normalisedPipelineId || verification?.pipelineId === normalisedPipelineId;
        const statusTargets = [
          normalisedPipelineStatusId,
          normalisedStatusId,
          ...normalisedStatusAliases,
        ];
        const statusMatches =
          statusTargets.length === 0 ||
          statusTargets.some((targetId) => verification?.statusId === targetId);

        verificationAttempts.push({
          snapshot: verification,
          pipelineMatches,
          statusMatches,
        });

        if (pipelineMatches && statusMatches) {
          break;
        }
      }
    }

    const ok =
      res.ok &&
      verificationAttempts.some((attemptItem) => attemptItem.pipelineMatches && attemptItem.statusMatches);

    const sent = spec.body;

    attemptHistory.push({
      attempt: spec.attempt,
      status: res.status,
      ok,
      body: parsed,
      sent,
      verification: verificationAttempts,
      url,
      method: spec.method,
    });

    return {
      ok,
      status: res.status,
      body: parsed,
      sent,
      verification: verificationAttempts,
      url,
      method: spec.method,
    };
  };

  const attemptsToTry: AttemptSpec[] = [];

  const baseLegacyBody: Record<string, unknown> = {};
  if (pipelineValue !== undefined) {
    baseLegacyBody.pipeline_id = pipelineValue;
    baseLegacyBody.to_pipeline_id = pipelineValue;
  }
  if (pipelineStatusValue !== undefined) {
    baseLegacyBody.pipeline_status_id = pipelineStatusValue;
  }
  if (statusValue !== undefined) {
    baseLegacyBody.status_id = statusValue;
    baseLegacyBody.to_status_id = statusValue;
  }

  attemptsToTry.push({
    attempt: "pipelines/cards/move",
    method: "POST",
    path: "/pipelines/cards/move",
    contentType: "application/json",
    body: {
      card_id: cardValue,
      ...(pipelineValue !== undefined ? { to_pipeline_id: pipelineValue, pipeline_id: pipelineValue } : {}),
      ...(pipelineStatusValue !== undefined
        ? { pipeline_status_id: pipelineStatusValue }
        : {}),
      ...(statusValue !== undefined
        ? {
            to_status_id: statusValue,
            status_id: statusValue,
          }
        : {}),
    },
  });

  attemptsToTry.push({
    attempt: "cards/{id}/move",
    method: "POST",
    path: `/cards/${encodeURIComponent(normalisedCardId)}/move`,
    contentType: "application/json",
    body: {
      ...(pipelineValue !== undefined
        ? { to_pipeline_id: pipelineValue, pipeline_id: pipelineValue }
        : {}),
      ...(pipelineStatusValue !== undefined
        ? { pipeline_status_id: pipelineStatusValue }
        : {}),
      ...(statusValue !== undefined
        ? {
            to_status_id: statusValue,
            status_id: statusValue,
          }
        : {}),
    },
  });

  attemptsToTry.push({
    attempt: "pipelines/cards/{id} PUT",
    method: "PUT",
    path: `/pipelines/cards/${encodeURIComponent(normalisedCardId)}`,
    contentType: "application/json",
    body: baseLegacyBody,
  });

  attemptsToTry.push({
    attempt: "pipelines/cards/{id} PUT jsonapi",
    method: "PUT",
    path: `/pipelines/cards/${encodeURIComponent(normalisedCardId)}`,
    contentType: "application/vnd.api+json",
    body: {
      data: {
        type: "pipelines-card",
        id: normalisedCardId,
        attributes: baseLegacyBody,
      },
    },
  });

  attemptsToTry.push({
    attempt: "pipelines/cards/{id} PATCH",
    method: "PATCH",
    path: `/pipelines/cards/${encodeURIComponent(normalisedCardId)}`,
    contentType: "application/json",
    body: baseLegacyBody,
  });

  const crmDealBody: Record<string, unknown> = {};
  if (pipelineValue !== undefined) {
    crmDealBody.pipeline_id = pipelineValue;
  }
  if (statusValue !== undefined) {
    crmDealBody.status_id = statusValue;
  }

  if (Object.keys(crmDealBody).length) {
    attemptsToTry.push({
      attempt: "crm/deals/{id} PATCH",
      method: "PATCH",
      path: `/crm/deals/${encodeURIComponent(normalisedCardId)}`,
      contentType: "application/json",
      body: crmDealBody,
    });

    attemptsToTry.push({
      attempt: "crm/deals/{id} PUT",
      method: "PUT",
      path: `/crm/deals/${encodeURIComponent(normalisedCardId)}`,
      contentType: "application/json",
      body: crmDealBody,
    });
  }

  if (statusValueAlias !== undefined) {
    const aliasBody: Record<string, unknown> = {
      ...(pipelineValue !== undefined
        ? { pipeline_id: pipelineValue, to_pipeline_id: pipelineValue }
        : {}),
      ...(pipelineStatusValue !== undefined ? { pipeline_status_id: pipelineStatusValue } : {}),
      status_id: statusValueAlias,
      to_status_id: statusValueAlias,
    };

    attemptsToTry.push({
      attempt: "pipelines/cards/move alias",
      method: "POST",
      path: "/pipelines/cards/move",
      contentType: "application/json",
      body: {
        card_id: cardValue,
        ...aliasBody,
      },
    });

    attemptsToTry.push({
      attempt: "cards/{id}/move alias",
      method: "POST",
      path: `/cards/${encodeURIComponent(normalisedCardId)}/move`,
      contentType: "application/json",
      body: aliasBody,
    });

    attemptsToTry.push({
      attempt: "crm/deals/{id} PATCH alias",
      method: "PATCH",
      path: `/crm/deals/${encodeURIComponent(normalisedCardId)}`,
      contentType: "application/json",
      body: aliasBody,
    });
  }

  let lastResult: {
    ok: boolean;
    status: number;
    body: unknown;
    sent: Record<string, unknown>;
    verification: KeycrmMoveAttempt[];
    url: string;
    method: AttemptSpec['method'];
    attemptName: string;
  } | null = null;

  for (const attemptSpec of attemptsToTry) {
    try {
      const result = await performAttempt(attemptSpec);

      lastResult = {
        ...result,
        attemptName: attemptSpec.attempt,
      };

      if (result.ok) {
        return {
          ok: true,
          status: result.status,
          response: {
            attempt: attemptSpec.attempt,
            body: result.body,
            history: attemptHistory,
          },
          sent: attemptSpec.body,
          attempts: result.verification,
          requestUrl: result.url,
          requestMethod: attemptSpec.method,
        };
      }
    } catch (error) {
      attemptHistory.push({
        attempt: attemptSpec.attempt,
        status: 0,
        ok: false,
        body: null,
        sent: attemptSpec.body,
        verification: [],
        url: join(base, attemptSpec.path),
        method: attemptSpec.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const fallbackResult = lastResult ?? {
    ok: false,
    status: 0,
    body: null,
    sent: baseLegacyBody,
    verification: [],
    url: join(base, attemptsToTry[0]?.path ?? ""),
    method: attemptsToTry[0]?.method ?? "POST",
    attemptName: attemptsToTry[0]?.attempt ?? "unknown",
  };

  return {
    ok: false,
    status: fallbackResult.status,
    response: {
      attempt: attemptHistory.at(-1)?.attempt ?? fallbackResult.attemptName ?? "jsonapi",
      body: fallbackResult.body,
      history: attemptHistory,
    },
    sent: attemptHistory.at(-1)?.sent ?? baseLegacyBody,
    attempts: fallbackResult.verification,
    requestUrl: fallbackResult.url,
    requestMethod: fallbackResult.method,
  };
}

export { normalizeId };
