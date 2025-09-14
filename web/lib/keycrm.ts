// web/lib/keycrm.ts
// Lightweight KeyCRM adapter used by routes. Exports used across the app.
// Adds missing kcGetStatusesByPipeline to fix the build.

const BASE = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

type Json = any;

async function kcFetch(path: string, init: RequestInit = {}) {
  const url = `${BASE.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${TOKEN}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string>),
  };

  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  let data: Json = null;
  try {
    data = await res.json();
  } catch {
    // ignore non-JSON
  }
  return { ok: res.ok, status: res.status, data };
}

/** GET /pipelines — список воронок */
export async function kcGetPipelines(): Promise<any[]> {
  const r = await kcFetch("/pipelines", { method: "GET" });
  if (!r.ok) throw new Error(`KeyCRM pipelines ${r.status}`);
  // API може повертати {data:[...]} або просто масив
  return Array.isArray(r.data) ? r.data : r.data?.data ?? [];
}

/** GET /pipelines/{pipelineId}/statuses — статуси конкретної воронки */
export async function kcGetStatusesByPipeline(pipelineId: number | string): Promise<any[]> {
  const id = String(pipelineId).trim();
  const r = await kcFetch(`/pipelines/${id}/statuses`, { method: "GET" });
  if (!r.ok) throw new Error(`KeyCRM statuses ${r.status}`);
  return Array.isArray(r.data) ? r.data : r.data?.data ?? [];
}

type ListCardsParams = {
  pipeline_id?: number | string;
  status_id?: number | string;
  page?: number;
  per_page?: number;
};

/**
 * GET /pipelines/cards?page=&per_page=&pipeline_id=&status_id=
 * Повертає laravel-стиль пагінації: { data:[], last_page } або { data:[], meta:{last_page} }
 */
export async function kcListCardsLaravel(params: ListCardsParams): Promise<{ data: any[]; last_page?: number; meta?: { last_page?: number } }> {
  const u = new URL(`${BASE.replace(/\/$/, "")}/pipelines/cards`);
  if (params.pipeline_id != null) u.searchParams.set("pipeline_id", String(params.pipeline_id));
  if (params.status_id != null) u.searchParams.set("status_id", String(params.status_id));
  u.searchParams.set("page", String(params.page ?? 1));
  u.searchParams.set("per_page", String(params.per_page ?? 50));

  const r = await kcFetch(u.pathname + "?" + u.searchParams.toString(), { method: "GET" });
  if (!r.ok) throw new Error(`KeyCRM cards ${r.status}`);
  const data = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
  const last_page = r.data?.last_page ?? r.data?.meta?.last_page;
  return { data, last_page, meta: r.data?.meta };
}

/** PUT /pipelines/cards/{cardId} — рух картки між статусами/воронками */
export async function kcMoveCard(
  cardId: number | string,
  to_pipeline_id?: number,
  to_status_id?: number
): Promise<{ ok: boolean; status: number; data: any; error?: any }> {
  const body: Record<string, any> = {};
  if (to_pipeline_id != null) body.pipeline_id = Number(to_pipeline_id);
  if (to_status_id != null) body.status_id = Number(to_status_id);

  const r = await kcFetch(`/pipelines/cards/${cardId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return r;
}
