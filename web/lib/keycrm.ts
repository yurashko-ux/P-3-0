// web/lib/keycrm.ts
/**
 * STRICT до твоїх ENV із канви:
 *  - KEYCRM_API_URL (default https://openapi.keycrm.app/v1)
 *  - KEYCRM_BEARER (повний рядок заголовка) АБО KEYCRM_API_TOKEN (ми зберемо Bearer ...)
 *
 * Ендпоїнти:
 *   GET /pipelines?per_page=200
 *   GET /pipelines/{pipelineId}/statuses?per_page=200
 */

const BASE = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const AUTH =
  process.env.KEYCRM_BEARER ??
  (process.env.KEYCRM_API_TOKEN ? `Bearer ${process.env.KEYCRM_API_TOKEN}` : "");

export type PipelineDTO = { id: string; name: string };
export type StatusDTO = { id: string; name: string };

function headers() {
  const h: Record<string, string> = { Accept: "application/json" };
  if (AUTH) h.Authorization = AUTH;
  return h;
}

function normList(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x?.data && Array.isArray(x.data)) return x.data;
  if (x?.items && Array.isArray(x.items)) return x.items;
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
  const data = await safeJson(`${BASE}/pipelines?per_page=200`);
  return normList(data).map((p: any) => ({
    id: String(p.id),
    name: String(p.name ?? p.title ?? p.label ?? p.slug ?? p.id),
  }));
}

export async function fetchStatuses(pipelineId: string): Promise<StatusDTO[]> {
  const pid = encodeURIComponent(pipelineId);
  const data = await safeJson(`${BASE}/pipelines/${pid}/statuses?per_page=200`);
  return normList(data).map((s: any) => ({
    id: String(s.id),
    name: String(s.name ?? s.title ?? s.label ?? s.slug ?? s.id),
  }));
}

/** Витягання назв із невеликим кешем у процесі (для пост-енрічменту на бекенді) */
const pipelineCache = new Map<string, string>();
const statusCache = new Map<string, Map<string, string>>();

export async function getPipelineName(pipelineId: string): Promise<string> {
  if (!pipelineId) return "";
  if (pipelineCache.has(pipelineId)) return pipelineCache.get(pipelineId)!;
  const list = await fetchPipelines();
  for (const p of list) pipelineCache.set(p.id, p.name);
  return pipelineCache.get(pipelineId) ?? pipelineId;
}

export async function getStatusName(pipelineId: string, statusId: string): Promise<string> {
  if (!pipelineId || !statusId) return "";
  const byPipe = statusCache.get(pipelineId) ?? new Map<string, string>();
  statusCache.set(pipelineId, byPipe);
  if (byPipe.has(statusId)) return byPipe.get(statusId)!;
  const list = await fetchStatuses(pipelineId);
  for (const s of list) byPipe.set(s.id, s.name);
  return byPipe.get(statusId) ?? statusId;
}

// Заглушка для сумісності старих імпортів
export type KcFindArgs = Record<string, unknown>;
export async function kcFindCardIdByAny(_q: string | KcFindArgs) {
  return { ok: false, id: null as string | null };
}
