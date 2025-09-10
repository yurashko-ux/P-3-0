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

// --------- ПАГІНАЦІЯ: сторінка карток у воронках ---------
export async function kcListPipelineCardsPage(
  page = 1,
  perPage = 50,
  params?: { search?: string; pipeline_id?: string; withContact?: boolean }
): Promise<{ items: any[]; done: boolean }> {
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("per_page", String(perPage));
  if (params?.search) q.set("search", params.search);
  if (params?.pipeline_id) q.set("pipeline_id", params.pipeline_id);
  if (params?.withContact) q.set("with", "contact");

  const { ok, json } = await kcFetch<{ data?: any[] }>(`/pipelines/cards?${q.toString()}`);
  const items = ok && Array.isArray((json as any)?.data) ? (json as any).data : [];
  // Якщо повернуло менше за perPage — це остання сторінка
  return { items, done: items.length < perPage };
}

// --------- Деталі картки (містять contact.*) ---------
export async function kcGetPipelineCard(cardId: number | string) {
  const { ok, json } = await kcFetch(`/pipelines/cards/${encodeURIComponent(String(cardId))}`);
  return ok ? ((json as any)?.data ?? json) : null;
}

// --------- Переміщення картки ---------
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

// --------- Утіліти нормалізації ---------
function normUsername(s?: string) {
  return (s || "").trim().replace(/^@+/, "").toLowerCase();
}
function normText(s?: string) {
  return (s || "").trim().toLowerCase();
}

// --------- «Розумний» пошук: title або contact.social_id ---------
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
  const maxPages = input.pageLimit ?? 40; // до ~2000 карток (40*50)

  let checked = 0;

  for (let page = 1; page <= maxPages; page++) {
    const { items, done } = await kcListPipelineCardsPage(page, 50, {
      search: fullName || username || undefined,
      pipeline_id,
      withContact: true,
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

      // 2) contact.social_id === username (перевіряємо деталі, якщо зразу не дали contact)
      if (username) {
        const listed = normUsername(card?.contact?.social_id);
        if (listed) {
          if (listed === username) {
            return { ok: true as const, card_id: Number(card.id), strategy: "list.contact.social_id", checked };
          }
        } else {
          const detail = await kcGetPipelineCard(card.id);
          const social =
            detail?.contact?.social_name === "instagram"
              ? normUsername(detail?.contact?.social_id)
              : "";
          if (social && social === username) {
            return { ok: true as const, card_id: Number(card.id), strategy: "detail.contact.social_id", checked };
          }
        }
      }
    }

    if (done) break;
  }

  return { ok: false as const, card_id: null, strategy: "not-found", checked };
}

/**
 * СУМІСНІСТЬ: старе API, яке викликають інші ручки
 * Повертаємо структуру { ok, username, card_id, strategy, checked }.
 */
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
