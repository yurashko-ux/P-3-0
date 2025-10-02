// web/lib/keycrm.ts
/**
 * KeyCRM client (STRICT to provided ENV).
 * Uses ONLY:
 *  - KEYCRM_API_URL (default https://openapi.keycrm.app/v1)
 *  - KEYCRM_BEARER (full header value, e.g. "Bearer XXX") OR
 *  - KEYCRM_API_TOKEN (we build "Authorization: Bearer <token>")
 *
 * Endpoints:
 *   GET /pipelines
 *   GET /pipelines/{pipelineId}/statuses
 */

const BASE = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");

const AUTH_HEADER_VALUE =
  process.env.KEYCRM_BEARER ??
  (process.env.KEYCRM_API_TOKEN ? `Bearer ${process.env.KEYCRM_API_TOKEN}` : "");

function headers() {
  const h: Record<string, string> = { Accept: "application/json" };
  if (AUTH_HEADER_VALUE) h.Authorization = AUTH_HEADER_VALUE;
  return h;
}

export type PipelineDTO = { id: string; name: string };
export type StatusDTO = { id: string; name: string };

function normalizeList(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x?.data && Array.isArray(x.data)) return x.data;
  return [];
}

async function safeJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!res.ok) {
      console.warn("[KeyCRM] non-OK", res.status, url);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("[KeyCRM] fetch error", url, e);
    return null;
  }
}

export async function fetchPipelines(): Promise<PipelineDTO[]> {
  const data = await safeJson(`${BASE}/pipelines`);
  const list = normalizeList(data);
  return list.map((p: any) => ({
    id: String(p.id),
    name: String(p.name ?? p.title ?? p.label ?? p.slug ?? p.id),
  }));
}

export async function fetchStatuses(pipelineId: string): Promise<StatusDTO[]> {
  const data = await safeJson(`${BASE}/pipelines/${encodeURIComponent(pipelineId)}/statuses`);
  const list = normalizeList(data);
  return list.map((s: any) => ({
    id: String(s.id),
    name: String(s.name ?? s.title ?? s.label ?? s.slug ?? s.id),
  }));
}

// ---- name helpers with in-process cache (no external envs) ----
const pipelineCache = new Map<string, string>();
const statusCache = new Map<string, Map<string, string>>();

export async function getPipelineName(pipelineId: string): Promise<string> {
  if (!pipelineId) return "";
  if (pipelineCache.has(pipelineId)) return pipelineCache.get(pipelineId)!;
  const ps = await fetchPipelines();
  for (const p of ps) pipelineCache.set(p.id, p.name);
  return pipelineCache.get(pipelineId) ?? pipelineId;
}

export async function getStatusName(pipelineId: string, statusId: string): Promise<string> {
  if (!pipelineId || !statusId) return "";
  const map = statusCache.get(pipelineId) ?? new Map<string, string>();
  statusCache.set(pipelineId, map);
  if (map.has(statusId)) return map.get(statusId)!;
  const ss = await fetchStatuses(pipelineId);
  for (const s of ss) map.set(s.id, s.name);
  return map.get(statusId) ?? statusId;
}

// Compatibility stub (not used now)
export type KcFindArgs = Record<string, unknown>;
export async function kcFindCardIdByAny(_q: string | KcFindArgs) {
  return { ok: false, id: null as string | null };
}
