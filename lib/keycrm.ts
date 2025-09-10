// lib/keycrm.ts
// Узагальнений клієнт + пошук картки за title (Instagram username)

const KEYCRM_BASE =
  process.env.KEYCRM_BASE_URL?.replace(/\/+$/, "") ||
  "https://openapi.keycrm.app/v1";

const KEYCRM_API_TOKEN =
  process.env.KEYCRM_API_TOKEN ||
  process.env.KEYCRM_BEARER ||
  process.env.KEYCRM_TOKEN;

type Json = any;

function norm(str: string) {
  return (str || "")
    .toString()
    .trim()
    .replace(/^@+/, "") // прибираємо @ на початку
    .toLowerCase();
}

export function keycrmConfigured() {
  return Boolean(KEYCRM_API_TOKEN && KEYCRM_BASE);
}

async function kcRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!keycrmConfigured()) {
    throw new Error("KeyCRM not configured");
  }
  const url = path.startsWith("http") ? path : `${KEYCRM_BASE}/${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${KEYCRM_API_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  init.headers = { ...headers, ...(init.headers as any) };
  const res = await fetch(url, init);
  return res;
}

/**
 * Повертає першу картку, у якої title === username (точна відповідність, без @, без регістру)
 * Пробує декілька пошукових варіантів і базову пагінацію.
 */
export async function kcFindCardIdByTitleSmart(
  username: string
): Promise<string | null> {
  if (!keycrmConfigured()) return null;
  const target = norm(username);
  if (!target) return null;

  // Кандидати URL пошуку (найпоширеніші варіації в KeyCRM API)
  const candidates = [
    `pipelines/cards?search=${encodeURIComponent(username)}&page[size]=100`,
    `pipelines/cards?title=${encodeURIComponent(username)}&page[size]=100`,
    `cards?search=${encodeURIComponent(username)}&page[size]=100`,
    `cards?title=${encodeURIComponent(username)}&page[size]=100`,
  ];

  for (const basePath of candidates) {
    // спробуємо пройти кілька сторінок (1..10) на випадок пагінації
    for (let page = 1; page <= 10; page++) {
      const sep = basePath.includes("?") ? "&" : "?";
      const path = `${basePath}${sep}page[number]=${page}`;

      let res: Response;
      try {
        res = await kcRequest(path, { method: "GET", cache: "no-store" as any });
      } catch {
        continue;
      }
      if (!res.ok) continue;

      let json: Json;
      try {
        json = await res.json();
      } catch {
        continue;
      }

      const items: any[] =
        json?.data ||
        json?.items ||
        json?.cards ||
        (Array.isArray(json) ? json : []);

      for (const it of items) {
        const id =
          it?.id ?? it?.card_id ?? it?.attributes?.id ?? it?.attributes?.card_id;
        const title =
        it?.title ?? it?.name ?? it?.attributes?.title ?? it?.attributes?.name;
        if (id && title && norm(title) === target) {
          return String(id);
        }
      }

      // якщо є ознаки пагінації й наступної сторінки немає — вилазимо з циклу сторінок
      const total = json?.meta?.total || json?.meta?.total_items;
      const perPage = json?.meta?.per_page || json?.meta?.page_size || 100;
      const current = json?.meta?.current_page || page;
      const last =
        json?.meta?.last_page ||
        (total && perPage ? Math.ceil(total / perPage) : undefined);

      if (last && current >= last) break;
      // якщо метаданих нема — після першої сторінки теж завершуємо (щоб не робити зайвих запитів)
      if (!json?.meta && page >= 1) break;
    }
  }

  return null;
}

/** Допоміжний «сирий» виклик (вже є у тебе, лишаю для зручності) */
export async function kcRaw(
  method: string,
  path: string,
  body?: any
): Promise<{ ok: boolean; status: number; url: string; method: string; response?: any; sent?: any }> {
  try {
    const res = await kcRequest(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res
      .clone()
      .json()
      .catch(() => undefined);

    return {
      ok: res.ok,
      status: res.status,
      url: path.startsWith("http") ? path : `${KEYCRM_BASE}/${path.replace(/^\/+/, "")}`,
      method,
      response: data,
      sent: body ?? null,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      url: path,
      method,
      response: { error: e?.message || String(e) },
      sent: body ?? null,
    };
    }
}

export { kcRequest };
