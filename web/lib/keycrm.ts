// web/lib/keycrm.ts
/**
 * SAFE інтеграція з KeyCRM:
 * - не кидає помилок назовні
 * - пробує кілька шляхів
 * - авторизація налаштовується через ENV
 *
 * ENV (будь-які комбінації):
 *  KEYCRM_API_URL="https://openapi.keycrm.app/v1"
 *  KEYCRM_API_TOKEN="..."               // значення токена
 *  KEYCRM_BEARER="Bearer X"            // якщо хочеш вказати заголовок повністю
 *  KEYCRM_AUTH_HEADER="Authorization"  // або інший, напр. "X-Api-Key"
 *  KEYCRM_AUTH_PREFIX="Bearer"         // або "Token" / "" (порожній, тоді лише токен)
 *  KEYCRM_EXTRA_HEADERS='{"X-Foo":"bar"}' // опціонально, JSON
 */

const BASE = (process.env.KEYCRM_API_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");

// --- авторизація ---
const AUTH_HEADER = process.env.KEYCRM_AUTH_HEADER || "Authorization";
const AUTH_PREFIX = process.env.KEYCRM_AUTH_PREFIX ?? "Bearer";
const TOKEN = process.env.KEYCRM_API_TOKEN || "";
const FULL_BEARER = process.env.KEYCRM_BEARER; // має пріоритет, якщо заданий
const EXTRA_HEADERS: Record<string, string> = safeParseJson(process.env.KEYCRM_EXTRA_HEADERS) || {};

function authHeaders() {
  if (FULL_BEARER) return { [AUTH_HEADER]: FULL_BEARER, ...EXTRA_HEADERS };
  if (TOKEN) {
    const val = AUTH_PREFIX !== undefined && AUTH_PREFIX !== null && AUTH_PREFIX !== ""
      ? `${AUTH_PREFIX} ${TOKEN}`
      : TOKEN;
    return { [AUTH_HEADER]: val, ...EXTRA_HEADERS };
  }
  return { ...EXTRA_HEADERS };
}

type PipelineDTO = { id: string; name: string };
type StatusDTO = { id: string; name: string };

type Trace = { path: string; status?: number; ok: boolean; error?: string; bodySnippet?: string };

function safeParseJson(s?: string): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// — утиліта «пробуй кілька шляхів, поки не вийде», із трасою
async function tryJsonWithTrace(paths: string[]): Promise<{ data: any | null; trace: Trace[] }> {
  const trace: Trace[] = [];
  for (const p of paths) {
    const url = `${BASE}${p}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", ...authHeaders() },
        cache: "no-store",
      });
      const t: Trace = { path: p, status: res.status, ok: res.ok };
      if (!res.ok) {
        t.bodySnippet = await safeText(res);
        trace.push(t);
        continue;
      }
      const data = await res.json().catch(async () => {
        t.error = "invalid json";
        t.bodySnippet = "";
        trace.push(t);
        return null;
      });
      trace.push(t);
      if (data) return { data, trace };
    } catch (e: any) {
      trace.push({ path: p, ok: false, error: String(e?.message || e) });
    }
  }
  return { data: null, trace };
}

function normalizeList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ------- Публічні SAFE функції -------

export async function fetchPipelines(): Promise<PipelineDTO[]> {
  const { data } = await tryJsonWithTrace([
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
  const { data } = await tryJsonWithTrace([
    `/pipelines/${pid}/statuses`,
    `/crm/pipelines/${pid}/statuses`,
    `/sales/pipelines/${pid}/statuses`,
    `/v1/pipelines/${pid}/statuses`,
  ]);
  const list = normalizeList(data);
  return list.map((s: any) => ({ id: String(s.id), name: String(s.name ?? s.title ?? s.label ?? s.slug ?? s.id) }));
}

// for diagnostics
export async function diagPipelines() {
  return await tryJsonWithTrace([
    "/pipelines", "/crm/pipelines", "/sales/pipelines", "/v1/pipelines",
  ]);
}
export async function diagStatuses(pipelineId: string) {
  const pid = encodeURIComponent(pipelineId);
  return await tryJsonWithTrace([
    `/pipelines/${pid}/statuses`,
    `/crm/pipelines/${pid}/statuses`,
    `/sales/pipelines/${pid}/statuses`,
    `/v1/pipelines/${pid}/statuses`,
  ]);
}

async function safeText(r: Response) {
  try { return (await r.text()).slice(0, 400); } catch { return ""; }
}

// --- простий процесний кеш (дублер KV), лишаємо як було ---
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

// ---- Сумісний заглушковий пошук (на майбутнє) ----
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
