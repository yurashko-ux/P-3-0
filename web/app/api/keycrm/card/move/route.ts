import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MoveBody = {
  card_id?: string | number | null;
  to_pipeline_id?: string | number | null;
  to_status_id?: string | number | null;
};

type CardSnapshot = {
  pipelineId: string | null;
  statusId: string | null;
  raw: unknown;
};

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizeId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function toKeycrmValue(id: string) {
  const asNumber = Number(id);
  return Number.isFinite(asNumber) ? asNumber : id;
}

function extractSnapshot(json: any): CardSnapshot {
  const data = Array.isArray(json?.data)
    ? json?.data[0]
    : json?.data ?? (Array.isArray(json) ? json[0] : json);

  const attributes =
    data && typeof data === "object" && "attributes" in (data as any)
      ? (data as any).attributes
      : data;

  const relationships =
    data && typeof data === "object" && "relationships" in (data as any)
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
}

async function fetchSnapshot(
  base: string,
  token: string,
  cardId: string
): Promise<CardSnapshot | null> {
  try {
    const res = await fetch(join(base, `/pipelines/cards/${encodeURIComponent(cardId)}`), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
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
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function ok(extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...(extra ?? {}) });
}

export async function POST(req: NextRequest) {
  const token = process.env.KEYCRM_API_TOKEN || "";
  const base = process.env.KEYCRM_BASE_URL || "";

  if (!token || !base) {
    return bad(500, "keycrm not configured", {
      need: { KEYCRM_API_TOKEN: !!token, KEYCRM_BASE_URL: !!base },
    });
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as MoveBody;

  const cardId = normalizeId(body.card_id);
  const toPipelineId = normalizeId(body.to_pipeline_id);
  const toStatusId = normalizeId(body.to_status_id);

  if (!cardId) return bad(400, "card_id required");
  if (!toPipelineId && !toStatusId) {
    return bad(400, "to_pipeline_id or to_status_id required");
  }

  const payload: Record<string, unknown> = {};
  if (toPipelineId) payload.pipeline_id = toKeycrmValue(toPipelineId);
  if (toStatusId) payload.status_id = toKeycrmValue(toStatusId);

  try {
    const res = await fetch(join(base, `/pipelines/cards/${encodeURIComponent(cardId)}`), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
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

    if (!res.ok) {
      return bad(res.status || 502, "keycrm move failed", {
        attempt: "pipelines/cards/{id} PUT",
        response: json,
        sent: payload,
      });
    }

    let verification: CardSnapshot | null = null;
    if (toPipelineId || toStatusId) {
      verification = await fetchSnapshot(base, token, cardId);
      if (
        verification &&
        ((toPipelineId && verification.pipelineId !== toPipelineId) ||
          (toStatusId && verification.statusId !== toStatusId))
      ) {
        return bad(502, "keycrm move unverified", {
          attempt: "pipelines/cards/{id} PUT",
          sent: payload,
          response: json,
          verify: verification,
        });
      }
    }

    return ok({
      moved: true,
      via: "pipelines/cards/{id} PUT",
      status: res.status,
      payloadSent: payload,
      response: json,
      verified: verification,
    });
  } catch (error) {
    return bad(502, "keycrm move failed", {
      attempt: "pipelines/cards/{id} PUT",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
