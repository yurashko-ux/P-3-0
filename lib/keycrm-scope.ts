// lib/keycrm-scope.ts
const BASE =
  (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(
    /\/$/,
    ""
  );
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

function kcUrl(path: string) {
  return `${BASE}/${path.replace(/^\//, "")}`;
}

async function kcGet(path: string) {
  const res = await fetch(kcUrl(path), {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function kcPut(path: string, body: any) {
  const res = await fetch(kcUrl(path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

type Scope = { pipeline_id: number; status_id: number };

type FindArgs = {
  username?: string; // contact.social_id
  fullNames?: string[]; // "Імʼя Прізвище" -> title === "Чат з <fullName>"
  pipeline_id: number;
  status_id: number;
  max_pages?: number;
};

/**
 * Повертає id картки в межах конкретної пари (pipeline + status)
 * Шукає спочатку по contact.social_id === username,
 * потім по title === "Чат з <fullName>".
 */
export async function kcFindCardIdInScope(args: FindArgs) {
  const username = (args.username || "").toLowerCase();
  const names = (args.fullNames || []).map((s) => s.trim()).filter(Boolean);
  const wantedTitle = names.map((n) => `Чат з ${n}`);

  const maxPages = Math.max(1, Math.min(20, args.max_pages ?? 3));
  const pageSize = 50;

  let checked = 0;
  for (let page = 1; page <= maxPages; page++) {
    // Обидві пагінації KeyCRM зустрічаються: ?page=X&per_page=Y або ?page[number]&page[size]
    const res =
      (await kcGet(`/pipelines/cards?page=${page}&per_page=${pageSize}`)) ||
      (await kcGet(
        `/pipelines/cards?page[number]=${page}&page[size]=${pageSize}`
      ));

    const data = (res.json?.data || []) as any[];
    for (const c of data) {
      // фільтруємо тільки базову пару кампанії
      if (c.pipeline_id !== args.pipeline_id || c.status_id !== args.status_id)
        continue;

      checked++;

      const social = (c.contact?.social_id || "").toLowerCase();
      if (username && social && username === social) {
        return { cardId: c.id as number, checked, pages: page };
      }

      const title = (c.title || "").trim();
      if (title && wantedTitle.includes(title)) {
        return { cardId: c.id as number, checked, pages: page };
      }
    }

    // якщо KeyCRM вернув менше елементів ніж pageSize — далі нема що читати
    if (!Array.isArray(data) || data.length < pageSize) break;
  }

  return { cardId: null as number | null, checked, pages: null as number | null };
}

/** Переміщення картки у вказану пару pipeline/status */
export async function kcMoveCard(
  cardId: number,
  pipeline_id: number,
  status_id: number
) {
  return kcPut(`/pipelines/cards/${cardId}`, { pipeline_id, status_id });
}
