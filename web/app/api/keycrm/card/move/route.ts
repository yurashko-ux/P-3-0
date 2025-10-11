// web/app/api/keycrm/card/move/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type MoveBody = {
  card_id: string;
  to_pipeline_id: string | null;
  to_status_id: string | null;
};

type CardSnapshot = {
  type: string | null;
  pipelineId: string | null;
  statusId: string | null;
  pipelineRelationshipTypes: string[];
  statusRelationshipTypes: string[];
  raw: unknown;
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

function normalizeId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function dedupe<T extends string>(values: (T | null | undefined)[]): T[] {
  const seen = new Set<T>();
  for (const value of values) {
    if (!value) continue;
    seen.add(value);
  }
  return Array.from(seen);
}

function collectRelationshipInfo(
  relationships: Record<string, any> | undefined,
  matcher: (key: string) => boolean
) {
  const types = new Set<string>();
  let firstId: string | null = null;

  if (!relationships || typeof relationships !== 'object') {
    return { id: null as string | null, types: [] as string[] };
  }

  for (const [key, rel] of Object.entries(relationships)) {
    if (!matcher(key)) continue;
    const data = (rel as any)?.data;
    const list = Array.isArray(data) ? data : data ? [data] : [];

    for (const entry of list) {
      const entryId = normalizeId((entry as any)?.id);
      if (entryId && !firstId) {
        firstId = entryId;
      }
      const entryType = typeof (entry as any)?.type === 'string' ? (entry as any).type : null;
      if (entryType) {
        types.add(entryType);
      }
    }
  }

  return { id: firstId, types: Array.from(types) };
}

/**
 * Деякі інсталяції KeyCRM мають різні шляхи для move:
 * - POST /cards/{card_id}/move            body: { pipeline_id, status_id }
 * - POST /pipelines/cards/move            body: { card_id, pipeline_id, status_id }
 * - PATCH /crm/deals/{card_id}            body: { pipeline_id, status_id }
 * Ми спробуємо їх послідовно й повернемо перший успішний.
 */
type AttemptTrace = {
  attempt: string;
  status: number;
  ok: boolean;
  text: string;
  json?: any;
};

type AttemptResult = {
  ok: boolean;
  attempt: string;
  status: number;
  text: string;
  json?: any;
  verified?: CardSnapshot | null;
  history?: AttemptTrace[];
};

type Attempt = {
  name: string;
  url: string;
  method?: 'POST' | 'PATCH' | 'PUT';
  body?: Record<string, unknown> | string | null;
  headers?: Record<string, string>;
};

async function fetchCardSnapshot(baseUrl: string, token: string, cardId: string): Promise<CardSnapshot | null> {
  const url = join(baseUrl, `/pipelines/cards/${encodeURIComponent(cardId)}`);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }

    const resource = Array.isArray(json?.data)
      ? json.data[0]
      : json?.data ?? (Array.isArray(json) ? json[0] : json);

    if (!resource || typeof resource !== 'object') {
      return null;
    }

    const resourceType = typeof (resource as any).type === 'string' ? (resource as any).type : null;
    const attributes =
      (resource as any)?.attributes && typeof (resource as any).attributes === 'object'
        ? (resource as any).attributes
        : (resource as any);

    const relationships =
      (resource as any)?.relationships && typeof (resource as any).relationships === 'object'
        ? (resource as any).relationships
        : undefined;

    const pipelineFromAttr = normalizeId(
      (attributes as any)?.pipeline_id ??
        (attributes as any)?.pipelineId ??
        (resource as any)?.pipeline_id ??
        (resource as any)?.pipelineId ??
        (resource as any)?.pipeline?.id
    );
    const statusFromAttr = normalizeId(
      (attributes as any)?.status_id ??
        (attributes as any)?.statusId ??
        (resource as any)?.status_id ??
        (resource as any)?.statusId ??
        (resource as any)?.status?.id
    );

    const pipelineRel = collectRelationshipInfo(relationships, (key) => /pipeline/i.test(key));
    const statusRel = collectRelationshipInfo(relationships, (key) => /status/i.test(key));

    return {
      type: resourceType,
      pipelineId: pipelineFromAttr ?? pipelineRel.id ?? null,
      statusId: statusFromAttr ?? statusRel.id ?? null,
      pipelineRelationshipTypes: pipelineRel.types,
      statusRelationshipTypes: statusRel.types,
      raw: json,
    };
  } catch {
    return null;
  }
}

type TryMoveOptions = {
  cardTypeCandidates?: string[];
  pipelineRelationshipTypes?: string[];
  statusRelationshipTypes?: string[];
  initialPipelineId?: string | null;
  initialStatusId?: string | null;
};

async function tryMove(
  baseUrl: string,
  token: string,
  body: MoveBody,
  options: TryMoveOptions = {}
): Promise<AttemptResult> {
  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  const coerceRestValue = (value: number | string) => {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : String(value);
  };

  const restPayload: Record<string, unknown> = {};
  const dealsPayload: Record<string, unknown> = {};
  const expectedPipelineId = normalizeId(body.to_pipeline_id);
  const expectedStatusId = normalizeId(body.to_status_id);

  if (expectedPipelineId != null) {
    const restValue = coerceRestValue(expectedPipelineId);
    restPayload.pipeline_id = restValue;
    restPayload.to_pipeline_id = restValue;
    dealsPayload.pipeline_id = restValue;
  }
  if (expectedStatusId != null) {
    const restValue = coerceRestValue(expectedStatusId);
    restPayload.status_id = restValue;
    restPayload.to_status_id = restValue;
    dealsPayload.status_id = restValue;
  }

  const cardTypeCandidates = dedupe([
    ...(options.cardTypeCandidates ?? []),
    'pipelines-card',
    'pipelines_card',
    'pipeline-card',
    'pipeline_card',
    'card',
    'deal',
  ]);

  const pipelineRelationshipTypes = expectedPipelineId
    ? dedupe([
        ...(options.pipelineRelationshipTypes ?? []),
        'pipelines',
        'pipeline',
        'crm-pipelines',
        'crm_pipeline',
        'pipelines-pipeline',
      ])
    : [];

  const statusRelationshipTypes = expectedStatusId
    ? dedupe([
        ...(options.statusRelationshipTypes ?? []),
        'pipeline-statuses',
        'pipeline_statuses',
        'pipeline-status',
        'pipeline_status',
        'pipelines-statuses',
        'pipelines_statuses',
        'status',
        'statuses',
        'crm-pipeline-statuses',
        'crm_pipeline_statuses',
      ])
    : [];

  const jsonApiAttempts: Attempt[] = [];

  if (expectedPipelineId != null || expectedStatusId != null) {
    const coerceAttrValue = (value: number | string) => {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) ? asNumber : String(value);
    };

    const pipelineTypeList = expectedPipelineId
      ? pipelineRelationshipTypes.length
        ? pipelineRelationshipTypes
        : ['pipelines']
      : [null];
    const statusTypeList = expectedStatusId
      ? statusRelationshipTypes.length
        ? statusRelationshipTypes
        : ['pipeline-statuses', 'pipeline_statuses', 'statuses']
      : [null];

    const seenCombos = new Set<string>();

    const cardTypes = cardTypeCandidates.length ? cardTypeCandidates : ['pipelines-card'];

    for (const cardType of cardTypes) {
      const attributes: Record<string, unknown> = {};
      if (expectedPipelineId != null) {
        attributes.pipeline_id = coerceAttrValue(expectedPipelineId);
      }
      if (expectedStatusId != null) {
        attributes.status_id = coerceAttrValue(expectedStatusId);
      }

      if (Object.keys(attributes).length) {
        jsonApiAttempts.push({
          url: join(baseUrl, `/pipelines/cards/${encodeURIComponent(body.card_id)}`),
          method: 'PUT',
          name: `pipelines/cards/{id} PUT attributes (type=${cardType})`,
          headers: {
            'Content-Type': 'application/vnd.api+json',
            Accept: 'application/vnd.api+json, application/json',
          },
          body: {
            data: {
              id: String(body.card_id),
              type: cardType,
              attributes,
            },
          },
        });
      }

      for (const pipelineType of pipelineTypeList) {
        for (const statusType of statusTypeList) {
          const key = [cardType, pipelineType ?? '-', statusType ?? '-'].join('|');
          if (seenCombos.has(key)) continue;
          seenCombos.add(key);

          if (pipelineType == null && statusType == null) {
            continue;
          }

          const relationships: Record<string, unknown> = {};

          if (expectedPipelineId != null) {
            relationships.pipeline = {
              data: {
                id: expectedPipelineId,
                ...(pipelineType ? { type: pipelineType } : {}),
              },
            };
          }

          if (expectedStatusId != null) {
            relationships.status = {
              data: {
                id: expectedStatusId,
                ...(statusType ? { type: statusType } : {}),
              },
            };
          }

          jsonApiAttempts.push({
            url: join(baseUrl, `/pipelines/cards/${encodeURIComponent(body.card_id)}`),
            method: 'PUT',
            name: `pipelines/cards/{id} PUT relationships (type=${cardType}, rel=${
              pipelineType ?? 'default'
            }/${statusType ?? 'default'})`,
            headers: {
              'Content-Type': 'application/vnd.api+json',
              Accept: 'application/vnd.api+json, application/json',
            },
            body: {
              data: {
                id: String(body.card_id),
                type: cardType,
                relationships,
              },
            },
          });
        }
      }
    }
  }

  const restPutPayload: Record<string, unknown> = Object.fromEntries(
    Object.entries(restPayload).filter(([key]) => !key.startsWith('to_'))
  );

  const attempts: Attempt[] = [
    {
      url: join(baseUrl, `/pipelines/cards/${encodeURIComponent(body.card_id)}`),
      name: 'pipelines/cards/{id} PUT',
      method: 'PUT',
      body: Object.keys(restPutPayload).length ? restPutPayload : null,
    },
    {
      url: join(baseUrl, `/cards/${encodeURIComponent(body.card_id)}/move`),
      name: 'cards/{id}/move',
      body: Object.keys(restPayload).length ? restPayload : null,
    },
    {
      url: join(baseUrl, `/pipelines/cards/move`),
      name: 'pipelines/cards/move',
      body: {
        card_id: body.card_id,
        ...restPayload,
      },
    },
    ...jsonApiAttempts,
    {
      url: join(baseUrl, `/crm/deals/${encodeURIComponent(body.card_id)}`),
      method: 'PATCH',
      name: 'crm/deals/{id} PATCH',
      body: dealsPayload,
    },
  ];

  let last: AttemptResult = {
    ok: false,
    attempt: '',
    status: 0,
    text: '',
  };

  const history: AttemptTrace[] = [];

  for (const a of attempts) {
    try {
      const r = await fetch(a.url, {
        method: a.method ?? 'POST',
        headers: {
          ...baseHeaders,
          ...(a.headers ?? {}),
          ...(!a.headers?.['Content-Type'] && a.body != null && typeof a.body !== 'string'
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body:
          a.body == null
            ? undefined
            : typeof a.body === 'string'
              ? a.body
              : JSON.stringify(a.body),
        cache: 'no-store',
      });

      const text = await r.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {}

      const success = r.ok && (j == null || j.ok === undefined || j.ok === true);

      const trace: AttemptTrace = { attempt: a.name, status: r.status, ok: success, text, json: j ?? undefined };
      history.push(trace);

      if (success) {
        if (expectedPipelineId != null || expectedStatusId != null) {
          const snapshotAfter = await fetchCardSnapshot(baseUrl, token, body.card_id);

          if (!snapshotAfter) {
            last = {
              ok: false,
              attempt: `${a.name} (verification missing)`,
              status: r.status,
              text,
              json: j ?? undefined,
              verified: null,
              history,
            };
            continue;
          }

          const pipelineMatches =
            expectedPipelineId == null || normalizeId(snapshotAfter.pipelineId) === expectedPipelineId;
          const statusMatches =
            expectedStatusId == null || normalizeId(snapshotAfter.statusId) === expectedStatusId;
          const unchangedPipeline =
            options.initialPipelineId != null &&
            normalizeId(snapshotAfter.pipelineId) === normalizeId(options.initialPipelineId);
          const unchangedStatus =
            options.initialStatusId != null &&
            normalizeId(snapshotAfter.statusId) === normalizeId(options.initialStatusId);

          if (pipelineMatches && statusMatches) {
            return {
              ok: true,
              attempt: a.name,
              status: r.status,
              text,
              json: j ?? undefined,
              verified: snapshotAfter,
              history,
            };
          }

          const reasons: string[] = [];
          if (!pipelineMatches && expectedPipelineId != null) {
            reasons.push(unchangedPipeline ? 'pipeline unchanged' : 'pipeline mismatch');
          }
          if (!statusMatches && expectedStatusId != null) {
            reasons.push(unchangedStatus ? 'status unchanged' : 'status mismatch');
          }

          last = {
            ok: false,
            attempt: `${a.name} (${reasons.join(', ') || 'verification mismatch'})`,
            status: r.status,
            text,
            json: j ?? undefined,
            verified: snapshotAfter,
            history,
          };
          continue;
        }

        return { ok: true, attempt: a.name, status: r.status, text, json: j ?? undefined, history };
      }

      last = { ok: false, attempt: a.name, status: r.status, text, json: j ?? undefined, history };
    } catch (e: any) {
      const trace: AttemptTrace = { attempt: a.name, status: 0, ok: false, text: String(e) };
      history.push(trace);
      last = { ok: false, attempt: a.name, status: 0, text: String(e), history };
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

  const snapshot = await fetchCardSnapshot(base, token, card_id);
  const typeCandidates = snapshot?.type ? [snapshot.type] : [];
  const pipelineRelationshipTypes = snapshot?.pipelineRelationshipTypes ?? [];
  const statusRelationshipTypes = snapshot?.statusRelationshipTypes ?? [];

  const res = await tryMove(
    base,
    token,
    { card_id, to_pipeline_id, to_status_id },
    {
      cardTypeCandidates: typeCandidates,
      pipelineRelationshipTypes,
      statusRelationshipTypes,
      initialPipelineId: snapshot?.pipelineId ?? null,
      initialStatusId: snapshot?.statusId ?? null,
    }
  );

  if (!res.ok) {
    return bad(502, 'keycrm move failed', {
      attempt: res.attempt,
      status: res.status,
      responseText: res.text,
      responseJson: res.json ?? null,
      sent: { card_id, to_pipeline_id, to_status_id },
      base: base.replace(/.{20}$/, '********'), // трохи маскуємо
      history: res.history,
      probe: snapshot
        ? {
            cardType: snapshot.type,
            pipelineId: snapshot.pipelineId,
            statusId: snapshot.statusId,
          }
        : undefined,
      verify: res.verified
        ? {
            pipelineId: res.verified.pipelineId,
            statusId: res.verified.statusId,
          }
        : undefined,
    });
  }

  return ok({
    moved: true,
    via: res.attempt,
    status: res.status,
    response: res.json ?? res.text,
    probe: snapshot
      ? {
          cardType: snapshot.type,
          pipelineId: snapshot.pipelineId,
          statusId: snapshot.statusId,
        }
      : undefined,
    verified: res.verified
      ? {
          pipelineId: res.verified.pipelineId,
          statusId: res.verified.statusId,
        }
      : null,
    history: res.history,
  });
}
