// web/lib/keycrm.ts
const BASE = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");

function ensureBearer(v?: string) {
  if (!v) return "";
  const s = v.trim();
  return s.toLowerCase().startsWith("bearer ") ? s : `Bearer ${s}`;
}

function buildAuth(): string {
  // Нормалізуємо ОБИДВА джерела
  const bearer = ensureBearer(process.env.KEYCRM_BEARER);
  const token  = ensureBearer(process.env.KEYCRM_API_TOKEN);
  return bearer || token || "";
}
const AUTH = buildAuth();

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

// кеш назв
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
  const map = statusCache.get(pipelineId) ?? new Map<string, string>();
  statusCache.set(pipelineId, map);
  if (map.has(statusId)) return map.get(statusId)!;
  const list = await fetchStatuses(pipelineId);
  for (const s of list) map.set(s.id, s.name);
  return map.get(statusId) ?? statusId;
}

// заглушки для сумісності
export type KcFindArgs = { [k: string]: unknown };
export async function kcFindCardIdByAny(_q: string | KcFindArgs) {
  return { ok: false, id: null as string | null };
}

export const __KEYCRM_ENV = {
  BASE,
  AUTH,
  startsWithBearer: !!AUTH && AUTH.toLowerCase().startsWith("bearer "),
};
