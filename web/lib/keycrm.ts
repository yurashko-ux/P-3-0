// web/lib/keycrm.ts

/**
 * Якщо у тебе вже є fetchPipelines/fetchStatuses — залишаємо їх,
 * нижче — референс імплементації + helper-и назв із простим кешем.
 */

const KEYCRM_API_URL = process.env.KEYCRM_API_URL ?? "https://openapi.keycrm.app/v1";
const KEYCRM_BEARER =
  process.env.KEYCRM_BEARER ?? `Bearer ${process.env.KEYCRM_API_TOKEN ?? ""}`;

type PipelineDTO = { id: string; name: string };
type StatusDTO = { id: string; name: string };

export async function fetchPipelines(): Promise<PipelineDTO[]> {
  const res = await fetch(`${KEYCRM_API_URL}/pipelines`, {
    headers: { Authorization: KEYCRM_BEARER },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("KeyCRM pipelines error:", res.status, await safeText(res));
    throw new Error(`KeyCRM pipelines failed: ${res.status}`);
  }
  const data = await res.json();
  const list = (Array.isArray(data) ? data : data?.data) ?? [];
  return list.map((p: any) => ({ id: String(p.id), name: String(p.name) }));
}

export async function fetchStatuses(pipelineId: string): Promise<StatusDTO[]> {
  const res = await fetch(`${KEYCRM_API_URL}/pipelines/${pipelineId}/statuses`, {
    headers: { Authorization: KEYCRM_BEARER },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("KeyCRM statuses error:", res.status, await safeText(res));
    throw new Error(`KeyCRM statuses failed: ${res.status}`);
  }
  const data = await res.json();
  const list = (Array.isArray(data) ? data : data?.data) ?? [];
  return list.map((s: any) => ({ id: String(s.id), name: String(s.name) }));
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return ""; }
}

// ---- Name helpers (in-memory cache на процес) ----

const pipelineCache = new Map<string, string>();
const statusCache = new Map<string, Map<string, string>>(); // pipelineId -> (statusId -> name)

export async function getPipelineName(pipelineId: string): Promise<string> {
  if (pipelineCache.has(pipelineId)) return pipelineCache.get(pipelineId)!;
  const list = await fetchPipelines();
  for (const p of list) pipelineCache.set(p.id, p.name);
  return pipelineCache.get(pipelineId) ?? pipelineId; // graceful fallback
}

export async function getStatusName(
  pipelineId: string,
  statusId: string
): Promise<string> {
  const byPipe = statusCache.get(pipelineId);
  if (byPipe?.has(statusId)) return byPipe.get(statusId)!;

  const list = await fetchStatuses(pipelineId);
  const map = byPipe ?? new Map<string, string>();
  for (const s of list) map.set(s.id, s.name);
  statusCache.set(pipelineId, map);

  return map.get(statusId) ?? statusId; // graceful fallback
}
