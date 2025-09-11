// web/lib/keycrm-find.ts
// Простий Пошук у KeyCRM: по contact.social_id (IG username) та/або по title "Чат з <ПІБ>"
// Виправлено: коректна пагінація (Laravel/JSON:API), не зупиняємось через rows.length<page_size.
// Додано: нормалізація username (обрізання "@"), гнучкий пошук title (exact/contains).

const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/$/, "");
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

type ScopeMode = "campaign" | "global";
type Strategy = "social" | "title" | "both";
type TitleMode = "exact" | "contains";

type FindArgs = {
  username?: string;     // contact.social_id (IG логін)
  full_name?: string;    // шукаємо у title як "Чат з <full_name>"
  pipeline_id?: number;  // якщо scope === "campaign"
  status_id?: number;    // якщо scope === "campaign"
  max_pages?: number;    // дефолт 3
  page_size?: number;    // дефолт 50 (KeyCRM може ігнорувати й повертати 15)
  strategy?: Strategy;   // дефолт both
  title_mode?: TitleMode;// дефолт exact
  scope?: ScopeMode;     // дефолт global
};

function norm(s?: string) {
  return (s || "").trim();
}
function cleanUsername(u?: string) {
  return norm(u).replace(/^@+/, "").toLowerCase();
}
function eqTitle(title: string, fullName: string) {
  return title === `Чат з ${fullName}`;
}
function containsTitle(title: string, fullName: string) {
  const hay = title.toLowerCase();
  const fn = fullName.toLowerCase();
  return hay.includes(fn) || hay.includes(`чат з ${fn}`);
}

function readMeta(json: any) {
  // Laravel style: { total, per_page, current_page, last_page, next_page_url }
  // JSON:API style: { meta: { total, per_page, current_page, last_page }, links: { next, prev } }
  const laravel = {
    total: json?.total ?? null,
    per_page: json?.per_page ?? null,
    current_page: json?.current_page ?? null,
    last_page: json?.last_page ?? null,
    next_page_url: json?.next_page_url ?? null,
  };
  const jsonapi = {
    total: json?.meta?.total ?? null,
    per_page: json?.meta?.per_page ?? null,
    current_page: json?.meta?.current_page ?? null,
    last_page: json?.meta?.last_page ?? null,
    next: json?.links?.next ?? null,
  };

  // вибір стилю
  const style: "laravel" | "jsonapi" =
    laravel.current_page != null || laravel.last_page != null || laravel.per_page != null
      ? "laravel"
      : "jsonapi";

  const meta =
    style === "laravel"
      ? laravel
      : { total: jsonapi.total, per_page: jsonapi.per_page, current_page: jsonapi.current_page, last_page: jsonapi.last_page, next_page_url: jsonapi.next };

  const actualPerPage =
    (typeof meta.per_page === "number" && meta.per_page > 0 && meta.per_page) || null;
  const current =
    (typeof meta.current_page === "number" && meta.current_page > 0 && meta.current_page) || null;
  const last =
    (typeof meta.last_page === "number" && meta.last_page > 0 && meta.last_page) || null;

  const hasNext =
    (typeof last === "number" && typeof current === "number" && current < last) ||
    Boolean(meta.next_page_url);

  return { style, actualPerPage, currentPage: current, lastPage: last, hasNext };
}

/** Простий пошук картки. НІЯКИХ переміщень — тільки знаходимо та повертаємо збіг. */
export async function findCardSimple(args: FindArgs) {
  const scope: ScopeMode = args.scope || "global";
  const username = cleanUsername(args.username);
  const fullName = norm(args.full_name);

  const max_pages = Math.max(1, Math.min(50, args.max_pages ?? 3));
  const requested_page_size = Math.max(1, Math.min(100, args.page_size ?? 50));
  const strategy: Strategy = args.strategy || "both";
  const title_mode: TitleMode = args.title_mode || "exact";

  if (!TOKEN) {
    return { ok: false, error: "missing_keycrm_token", hint: "Додай KEYCRM_API_TOKEN у Vercel Env." };
  }
  if (!username && !fullName) {
    return { ok: false, error: "no_lookup_keys", hint: "Передай username або full_name." };
  }
  if (scope === "campaign" && (!args.pipeline_id || !args.status_id)) {
    return {
      ok: false,
      error: "campaign_scope_missing",
      hint: "Для scope=campaign потрібні pipeline_id і status_id (додай їх у query).",
      used: { scope, pipeline_id: args.pipeline_id, status_id: args.status_id },
    };
  }

  let checked = 0;
  let matched: any = null;
  let pagination: "laravel" | "jsonapi" | null = null;
  let pages_scanned = 0;
  let actual_page_size: number | null = null;

  for (let page = 1; page <= max_pages; page++) {
    // пробуємо обидва формати пагінації
    const r1 = await kcGet(`/pipelines/cards?page=${page}&per_page=${requested_page_size}`);
    const useR1 = r1.ok && Array.isArray(r1.json?.data);
    const resp = useR1 ? r1 : await kcGet(`/pipelines/cards?page[number]=${page}&page[size]=${requested_page_size}`);

    const rows: any[] = Array.isArray(resp.json?.data) ? resp.json.data : [];
    const meta = readMeta(resp.json);
    pagination = meta.style;
    actual_page_size = meta.actualPerPage ?? actual_page_size ?? null;

    // фільтр за campaign scope (якщо треба)
    const filtered =
      scope === "campaign"
        ? rows.filter(
            (r) => r.pipeline_id === args.pipeline_id && r.status_id === args.status_id
          )
        : rows;

    for (const c of filtered) {
      checked++;

      const title = norm(c.title);
      const social = cleanUsername(c.contact?.social_id);

      const socialHit =
        (strategy === "social" || strategy === "both") && username
          ? social && social === username
          : false;

      const titleHit =
        (strategy === "title" || strategy === "both") && fullName
          ? title_mode === "exact"
            ? eqTitle(title, fullName)
            : containsTitle(title, fullName)
          : false;

      if (socialHit || titleHit) {
        matched = {
          id: c.id,
          title: c.title,
          pipeline_id: c.pipeline_id,
          status_id: c.status_id,
          contact_social: c.contact?.social_id || null,
        };
        break;
      }
    }

    pages_scanned = page;
    if (matched) break;

    // РІШЕННЯ: не зупиняємось по rows.length < requested_page_size.
    // Йдемо далі, якщо meta показує наявність наступної сторінки І ми ще не вичерпали max_pages.
    if (!meta.hasNext) break;
  }

  return {
    ok: true,
    username: username || null,
    full_name: fullName || null,
    scope,
    used: {
      pagination,
      actual_page_size,
      requested_page_size,
      pipeline_id: args.pipeline_id ?? null,
      status_id: args.status_id ?? null,
      max_pages,
      strategy,
      title_mode,
      pages_scanned,
    },
    result: matched,
    checked,
  };
}
