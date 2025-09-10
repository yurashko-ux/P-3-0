// web/lib/keycrm.ts
const KC_BASE = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
const KC_TOKEN = process.env.KEYCRM_API_TOKEN;

function authHeaders(extra: HeadersInit = {}) {
  if (!KC_TOKEN) throw new Error("KEYCRM_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${KC_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function kcFetch<T = any>(path: string, init?: RequestInit) {
  const res = await fetch(`${KC_BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers || {}),
    cache: "no-store",
  });
  const json = await res
    .json()
    .catch(() => ({ message: "no-json", status: res.status }));
  return { ok: res.ok, status: res.status, json } as {
    ok: boolean;
    status: number;
    json: T;
  };
}

// Сторінка карток у воронках (laravel: ?page=&per_page=)
export async function kcListPipelineCardsPage(
  page = 1,
  perPage = 50
): Promise<{ items: any[]; done: boolean }> {
  const { ok, json } = await kcFetch<{ data?: any[] }>(
    `/pipelines/cards?page=${page}&per_page=${perPage}`
  );
  const items = ok && Array.isArray((json as any).data) ? (json as any).data : [];
  // Якщо повернуло менше, ніж perPage — остання сторінка
  return { items, done: items.length < perPage };
}

// Деталі однієї картки (важливо: тут є contact.social_id / social_name)
export async function kcGetPipelineCard(cardId: number | string) {
  const { ok, json } = await kcFetch(`/pipelines/cards/${cardId}`);
  return ok ? (json as any) : null;
}

// Перемістити картку (PUT pipelines/cards/{id})
export async function kcMoveCard(
  cardId: number | string,
  to_pipeline_id: number | string,
  to_status_id: number | string
) {
  return kcFetch(`/pipelines/cards/${cardId}`, {
    method: "PUT",
    body: JSON.stringify({
      pipeline_id: Number(to_pipeline_id),
      status_id: Number(to_status_id),
    }),
  });
}

function normUsername(s?: string) {
  return (s || "").trim().replace(/^@/g, "").toLowerCase();
}
function normText(s?: string) {
  return (s || "").trim().toLowerCase();
}

// «Розумний» пошук картки: спершу title, потім contact.social_id
export async function kcFindCardIdByAny(input: {
  username?: string; // ig login без @
  fullName?: string; // ПІБ
  pageLimit?: number; // захист від нескінч. циклу
}) {
  const username = normUsername(input.username);
  const fullName = (input.fullName || "").trim();
  const fullNameLc = normText(fullName);
  const maxPages = input.pageLimit ?? 40; // до ~2000 карток (40*50)

  let checked = 0;

  for (let page = 1; page <= maxPages; page++) {
    const { items, done } = await kcListPipelineCardsPage(page, 50);

    for (const card of items) {
      checked++;

      // 1) title містить full name (Кейси типу "Чат з <Full Name>")
      if (fullName) {
        const t = normText(card?.title);
        if (t && (t.includes(fullNameLc) || t.includes(`чат з ${fullNameLc}`))) {
          return { ok: true as const, card_id: card.id, strategy: "title", checked };
        }
      }

      // 2) contact.social_id === username (потрібен додатковий запрос)
      if (username) {
        const detail = await kcGetPipelineCard(card.id);
        const social =
          detail?.contact?.social_name === "instagram"
            ? normUsername(detail?.contact?.social_id)
            : "";
        if (social && social === username) {
          return { ok: true as const, card_id: card.id, strategy: "contact.social_id", checked };
        }
      }
    }

    if (done) break;
  }

  return { ok: false as const, card_id: null, strategy: "not-found", checked };
}
