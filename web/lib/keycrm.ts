// web/lib/keycrm.ts
// KeyCRM REST adapter: fetch helper, list cards (Laravel-style), move card, pipelines/statuses, normalizer
// ENV required: KEYCRM_BASE_URL (default https://openapi.keycrm.app/v1), KEYCRM_API_TOKEN

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const BASE_URL = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

if (!TOKEN) {
  // Do not throw at import time in Next.js; just warn on server side
  console.warn("[keycrm] Missing KEYCRM_API_TOKEN");
}

function qs(params: Record<string, any> = {}): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function keycrmFetch<T = any>(
  path: string,
  {
    method = "GET",
    query,
    body,
    timeoutMs = 10_000,
  }: {
    method?: HttpMethod;
    query?: Record<string, any>;
    body?: any;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: any }> {
  const url = `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}${qs(query)}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(id);

    let data: any = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data, error: data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(id);
    return { ok: false, status: 0, data: null, error: err };
  }
}

/** ---------- Public API ---------- */

export async function kcGetPipelines() {
  return keycrmFetch<any[]>("/pipelines");
}

export async function kcGetStatuses(pipelineId: string | number) {
  // Some docs use /pipelines/{id}/statuses; keep both patterns just in case
  const a = await keycrmFetch<any[]>(`/pipelines/${pipelineId}/statuses`);
  if (a.ok) return a;
  return keycrmFetch<any[]>("/pipelines/statuses", { query: { pipeline_id: pipelineId } });
}

export interface ListCardsParams {
  pipeline_id: string | number;
  status_id: string | number;
  page?: number;
  per_page?: number;
}

/**
 * GET /pipelines/cards?page=&per_page=&pipeline_id=&status_id=
 * Returns Laravel-like pagination { total, current_page, per_page, data: [], last_page?, meta? }
 */
export async function kcListCardsLaravel(params: ListCardsParams) {
  const { pipeline_id, status_id, page = 1, per_page = 50 } = params;
  return keycrmFetch<any>("/pipelines/cards", {
    method: "GET",
    query: { pipeline_id, status_id, page, per_page },
  });
}

/**
 * Move card to another pipeline/status.
 * PUT /pipelines/cards/{cardId} with { pipeline_id?, status_id? }
 */
export async function kcMoveCard(
  cardId: string | number,
  to_pipeline_id?: string | number | null,
  to_status_id?: string | number | null,
) {
  const body: Record<string, any> = {};
  if (to_pipeline_id != null && to_pipeline_id !== "") body.pipeline_id = Number(to_pipeline_id);
  if (to_status_id != null && to_status_id !== "") body.status_id = Number(to_status_id);

  if (Object.keys(body).length === 0) {
    return { ok: true, status: 200, data: { noop: true } };
  }

  return keycrmFetch(`/pipelines/cards/${cardId}`, {
    method: "PUT",
    body,
  });
}

/** ---------- Normalization helpers ---------- */

export type NormalizedCard = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string; // ISO-ish or 'YYYY-MM-DD HH:mm:ss'
};

export function normalizeCard(raw: any): NormalizedCard {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName = String(raw?.contact?.social_name ?? "").toLowerCase() || null;
  const socialId = raw?.contact?.social_id ?? null;
  const fullName = raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null;

  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? "").trim(),
    pipeline_id: pipelineId != null ? Number(pipelineId) : null,
    status_id: statusId != null ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName ?? null,
    updated_at: String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  };
}

export function toEpoch(x?: string | number | Date | null): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : Date.now();
  }
  return Date.now();
}
