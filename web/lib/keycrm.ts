// web/lib/keycrm.ts
// Lightweight KeyCRM adapter used by routes.
// Exports: kcGetPipelines, kcGetStatusesByPipeline, kcListCardsLaravel, kcMoveCard,
//          findCardIdByUsername, kcFindCardIdByAny

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
  return Array.isArray(r.data) ? r.data : r.data?.data ?? [];
}

/** GET /pipelines/{pipelineId}/statuses — статуси конкретної воронки */
export async function kcGetStatusesByPipeline(pipelineId: number | string): Promise<any[]> {
  const id = String(pipelineId).trim();
  const r = await kcFetch(`/pipelines/${id}/statuses`, { method: "GET" });
  if (!r.ok) throw new Error(`KeyCRM statuses ${r.status}`);
  return Array.isArray(r.data) ? r.data : r.data?.data ?? [];
}

/**
 * GET /pipelines/cards?page=&per_page=&pipeline_id=&status_id=
 * Повертає або { data:[], last_page } або { data:[], meta:{ last_page } }.
 */
export async function kcListCardsLaravel(params: {
  pipeline_id?: number | string;
  status_id?: number | string;
  page?: number;
  per_page?: number;
}): Promise<{ data: any[]; last_page?: number; meta?: { last_page?: number } }> {
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

/* -------------------------- helpers for search -------------------------- */

function normHandle(v?: string) {
  return (v ?? "").trim().replace(/^@/, "").toLowerCase();
}

/**
 * Пошук card_id за IG username в межах (pipeline_id,status_id).
 * Перебирає сторінки KeyCRM (дешево, без KV).
 */
export async function findCardIdByUsername(username: string, opts: {
  pipeline_id?: number | string;
  status_id?: number | string;
  per_page?: number;
  max_pages?: number;
} = {}): Promise<number | null> {
  const handle = normHandle(username);
  if (!handle) return null;

  const perPage = opts.per_page ?? 50;
  const maxPages = opts.max_pages ?? 5;

  let page = 1;
  let last = Infinity;

  while (page <= maxPages && page <= last) {
    const resp = await kcListCardsLaravel({
      pipeline_id: opts.pipeline_id,
      status_id: opts.status_id,
      page,
      per_page: perPage,
    });
    last = resp.last_page ?? resp.meta?.last_page ?? page;

    for (const raw of resp.data ?? []) {
      const socialName = String(raw?.contact?.social_name ?? "").toLowerCase();
      const socialId = normHandle(raw?.contact?.social_id);
      if (socialName === "instagram" && socialId && socialId === handle) {
        const idNum = Number(raw?.id);
        return Number.isFinite(idNum) ? idNum : null;
      }
    }
    if (page >= last) break;
    page++;
  }
  return null;
}

/**
 * Комбінований пошук: спочатку за username, далі — по full name/title.
 * Повертає перший знайдений card_id або null.
 */
export async function kcFindCardIdByAny(params: {
  username?: string;
  fullname?: string;
  pipeline_id?: number | string;
  status_id?: number | string;
  per_page?: number;
  max_pages?: number;
}): Promise<number | null> {
  // 1) username
  if (params.username) {
    const byUser = await findCardIdByUsername(params.username, params);
    if (byUser) return byUser;
  }

  // 2) fallback: full name у title або contact.full_name
  const fullname = (params.fullname ?? "").trim();
  if (!fullname) return null;

  const needle = fullname.toLowerCase();
  const perPage = params.per_page ?? 50;
  const maxPages = params.max_pages ?? 5;

  let page = 1;
  let last = Infinity;

  while (page <= maxPages && page <= last) {
    const resp = await kcListCardsLaravel({
      pipeline_id: params.pipeline_id,
      status_id: params.status_id,
      page,
      per_page: perPage,
    });
    last = resp.last_page ?? resp.meta?.last_page ?? page;

    for (const raw of resp.data ?? []) {
      const title = String(raw?.title ?? "").toLowerCase();
      const full = String(
        raw?.contact?.full_name ??
        raw?.contact?.client?.full_name ??
        ""
      ).toLowerCase();

      if ((title && title.includes(needle)) || (full && full.includes(needle))) {
        const idNum = Number(raw?.id);
        return Number.isFinite(idNum) ? idNum : null;
      }
    }
    if (page >= last) break;
    page++;
  }
  return null;
}
