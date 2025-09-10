// web/lib/keycrm.ts
// KeyCRM helpers: списки карток, деталі, move, «розумний» пошук за IG username або Full Name
const KC_BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/+$/, "");
const KC_TOKEN = process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER;

function authHeaders(extra: HeadersInit = {}) {
  if (!KC_TOKEN) throw new Error("KEYCRM_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${KC_TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function kcFetch<T = any>(path: string, init?: RequestInit) {
  const res = await fetch(`${KC_BASE}${path.startsWith("/") ? "" : "/"}${path}`, {
    ...init,
    headers: authHeaders(init?.headers || {}),
    cache: "no-store",
  });
  let json: any = null;
  try { json = await res.clone().json(); } catch { json = null; }
  return { ok: res.ok, status: res.status, json } as { ok: boolean; status: number; json: T };
}

/* ---------------- ПАГІНАЦІЯ: сторінка карток у воронках ----------------
   Важливо: KeyCRM інколи повертає meta у корені (laravel style):
   { total, current_page, per_page, last_page, next_page_url, data: [...] }
   А інколи – всередині meta/links (jsonapi-like).
   Ми парсимо ОБИДВА варіанти. */
type ListParams = { search?: string; pipeline_id?: string; withContact?: boolean; page?: number; perPage?: number };

function parseListResponse(j: any) {
  const dataArr = Array.isArray(j?.data) ? j.data
                : Array.isArray(j?.items) ? j.items
                : Array.isArray(j?.result) ? j.result
                : Array.isArray(j?.data?.items) ? j.data.items
                : [];

  // laravel-style у корені
  const current1 = Number(j?.current_page ?? NaN);
  const last1    = Number(j?.last_page ?? NaN);
  const next1    = j?.next_page_url ?? j?.links?.next;

  // jsonapi/інший стиль
  const current2 = Number(j?.meta?.current_page ?? j?.meta?.page ?? NaN);
  const last2    = Number(j?.meta?.last_page ?? j?.meta?.pages ?? NaN);
  const next2    = j?.meta?.next_page_url ?? j?.links?.next;

  const current_page = Number.isFinite(current1) ? current1 : (Number.isFinite(current2) ? current2 : NaN);
  const last_page    = Number.isFinite(last1)    ? last1    : (Number.isFinite(last2)    ? last2    : NaN);
  const next_page_url = (typeof next1 === "string" && next1) ? next1 : ((typeof next2 === "string" && next2) ? next2 : null);

  // Головне правило: якщо є current/last — використовуємо їх; інакше – орієнтуємось на next_page_url
  const hasMore =
    (Number.isFinite(current_page) && Number.isFinite(last_page) && current_page < last_page)
    || (!!next_page_url);

  return { items: dataArr, hasMore };
}

export async function kcListPipelineCardsPage(params: ListParams = {}) {
  const page = params.page ?? 1;
  const per  = params.perPage ?? 50;

  // Додаємо ОБИДВА варіанти with (деякі інсталяції приймають тільки один)
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("per_page", String(per));
  if (params.search) q.set("search", params.search);
  if (params.pipeline_id) q.set("pipeline_id", params.pipeline_id);
  if (params.withContact) {
    q.set("with", "contact");
    q.append("with[]", "contact");
  }

  const { ok, json } = await kcFetch<any>(`/pipelines/cards?${q.toString()}`);
  if (!ok) return { items: [] as any[], hasMore: false };
  return parseListResponse(json);
}

/* ---------------- Деталі картки (містять contact.*) ---------------- */
export async function kcGetPipelineCard(cardId: number | string) {
  const { ok, json } = await kcFetch(`/pipelines/cards/${encodeURIComponent(String(cardId))}`);
  return ok ? ((json as any)?.data ?? json) : null;
}

/* ---------------- Переміщення картки ---------------- */
export async function kcMoveCard(
  cardId: number | string,
  to_pipeline_id: number | string,
  to_status_id: number | string
) {
  return kcFetch(`/pipelines/cards/${encodeURIComponent(String(cardId))}`, {
    method: "PUT",
    body: JSON.stringify({
      pipeline_id: Number(to_pipeline_id),
      status_id: Number(to_status_id),
    }),
  });
}

/* ---------------- Утіліти нормалізації ---------------- */
function normUsername(s?: string) {
  return (s || "").trim().replace(/^@+/, "").toLowerCase();
}
function normText(s?: string) {
  return (s || "").trim().toLowerCase();
}

/* ---------------- «Розумний» пошук: title або contact.social_id ---------------- */
export async function kcFindCardIdByAny(input: {
  username?: string;            // IG login без @
  fullName?: string;            // ПІБ для title ("Чат з …")
  pipeline_id?: string;         // опц. звузити пошук в одній воронці
  pageLimit?: number;           // межа сторінок
}) {
  const username = normUsername(input.username);
  const fullName = (input.fullName || "").trim();
  const fullNameLc = normText(fullName);
  const pipeline_id = input.pipeline_id;
  const maxPages = input.pageLimit ?? 200; // з запасом (200*50=10к)

  let checked = 0;
  let page = 1;

  while (page <= maxPages) {
    const { items, hasMore } = await kcListPipelineCardsPage({
      page, perPage: 50,
      search: fullName || username || undefined,
      pipeline_id, withContact: true,
    });

    for (const card of items) {
      checked++;

      // 1) title містить ПІБ (кейси "Чат з <Full Name>")
      if (fullName) {
        const t = normText(card?.title);
        if (t && (t.includes(fullNameLc) || t.includes(`чат з ${fullNameLc}`))) {
          return { ok: true as const, card_id: Number(card.id), strategy: "title", checked };
        }
      }

      // 2) contact.social_id === username
      if (username) {
        const listed = normUsername(card?.contact?.social_id);
        const listedName = (card?.contact?.social_name || "").toLowerCase();
        if (listed && listedName === "instagram" && listed === username) {
          return { ok: true as const, card_id: Number(card.id), strategy: "list.contact.social_id", checked };
        }

        // Якщо в списку нема contact — підстрахуємось деталями
        if (!card?.contact) {
          const detail = await kcGetPipelineCard(card.id);
          const social =
            (detail?.contact?.social_name || "").toLowerCase() === "instagram"
              ? normUsername(detail?.contact?.social_id)
              : "";
          if (social && social === username) {
            return { ok: true as const, card_id: Number(card.id), strategy: "detail.contact.social_id", checked };
          }
        }
      }
    }

    if (!hasMore) break;
    page++;
  }

  return { ok: false as const, card_id: null, strategy: "not-found", checked };
}

/* -------- СУМІСНІСТЬ: старе API, яке викликають інші ручки -------- */
export async function findCardIdByUsername(usernameRaw: string, pipelineId?: string) {
  const res = await kcFindCardIdByAny({ username: usernameRaw, pipeline_id: pipelineId });
  return {
    ok: res.ok,
    username: usernameRaw,
    card_id: res.ok ? res.card_id : null,
    strategy: res.strategy,
    checked: res.checked,
  };
}
