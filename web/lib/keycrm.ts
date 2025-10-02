// web/lib/keycrm.ts
/**
 * SAFE-версія інтеграції з KeyCRM із багатоваріантними шляхами.
 * НІКОЛИ не кидає помилки назовні: повертає [] / fallback-дані.
 */

const BASE = process.env.KEYCRM_API_URL?.replace(/\/+$/, "") || "https://openapi.keycrm.app/v1";
const AUTH =
  process.env.KEYCRM_BEARER ??
  (process.env.KEYCRM_API_TOKEN ? `Bearer ${process.env.KEYCRM_API_TOKEN}` : "");

type PipelineDTO = { id: string; name: string };
type StatusDTO = { id: string; name: string };

// — утиліта «пробуй кілька шляхів, поки не вийде»
async function tryJson(paths: string[]): Promise<any | null> {
  for (const p of paths) {
    try {
      const url = `${BASE}${p}`;
      const res = await fetch(url, {
        headers: {
          ...(AUTH ? { Authorization: AUTH } : {}),
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn("KeyCRM non-OK:", res.status, p);
        continue;
      }
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn("KeyCRM fetch error:", p, e);
    }
  }
  return null;
}

function normalizeList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ------- Публічні SAFE функції -------

export async function fetchPipelines(): Promise<PipelineDTO[]> {
  const data = await tryJson([
    "/pipelines",
    "/crm/pipelines",
    "/sales/pipelines",
    "/v1/pipelines",
  ]);
  const list = normalizeList(data);
  return list.map((p: any) => ({ id: String(p.id), name: String(p.name ?? p.title ?? p.label ?? p.slug ?? p.id) }));
}

export async function fetchStatuses(pipelineId: string): Promise<StatusDTO[]> {
  const pid = encodeURIComponent(pipelineId);
  const data = await tryJson([
    `/pipelines/${pid}/statuses`,
    `/crm/pipelines/${pid}/statuses`,
    `/sales/pipelines/${pid}/statuses`,
    `/v1/pipelines/${pid}/statuses`,
  ]);
  const list = normalizeList(data);
  return list.map((s: any) => ({ id: String(s.id), name: String(s.name ?? s.title ?? s.label ?? s.slug ?? s.id) }));
}

// --- Кеш у пам'яті процеса (дублер KV) ---
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

// ---- Сумісний заглушковий пошук (не використовується, але потрібен імпортам) ----
export type KcFindArgs = {
  username?: string;
  fullname?: string;
  pipeline_id?: string | number;
  status_id?: string | number;
  per_page?: number;
  max_pages?: number;
};
export async function kcFindCardIdByAny(
  _query: string | KcFindArgs
): Promise<{ ok: boolean; id?: string | null } | null> {
  return { ok: false, id: null };
}
