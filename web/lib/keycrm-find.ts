// web/lib/keycrm-find.ts
// Пошук картки у KeyCRM з фокусом на БАЗОВУ воронку/статус (scope=campaign),
// універсальне порівняння social_id (з/без "@") і, за потреби, перевірка social_name.

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
type Strategy = "social" | "full_name" | "both";
type TitleMode = "exact" | "contains";

type FindArgs = {
  social_id?: string;      // contact.social_id (може містити "@")
  full_name?: string;      // contact.full_name або назва картки
  social_name?: string;    // instagram | telegram | ...
  pipeline_id?: number;    // якщо scope=campaign
  status_id?: number;      // якщо scope=campaign
  max_pages?: number;      // дефолт 3
  page_size?: number;      // дефолт 50
  strategy?: Strategy;     // дефолт both
  title_mode?: TitleMode;  // дефолт exact
  scope?: ScopeMode;       // дефолт global
};

const norm = (s?: string) => (s || "").trim();
const low  = (s?: string) => norm(s).toLowerCase();
const stripAt = (s: string) => s.replace(/^@+/, "");

function eqTitleExact(title: string, fullName: string) {
  return title === `Чат з ${fullName}`;
}
function titleContains(title: string, fullName: string) {
  const hay = title.toLowerCase();
  const fn  = fullName.toLowerCase();
  return hay.includes(fn) || hay.includes(`чат з ${fn}`);
}

function readMeta(json: any) {
  // Laravel style
  const laravel = {
    total: json?.total ?? null,
    per_page: json?.per_page ?? null,
    current_page: json?.current_page ?? null,
    last_page: json?.last_page ?? null,
    next_page_url: json?.next_page_url ?? null,
  };
  // JSON:API style
  const jsonapi = {
    total: json?.meta?.total ?? null,
    per_page: json?.meta?.per_page ?? null,
    current_page: json?.meta?.current_page ?? null,
    last_page: json?.meta?.last_page ?? null,
    next: json?.links?.next ?? null,
  };

  const style: "laravel" | "jsonapi" =
    laravel.current_page != null || laravel.last_page != null || laravel.per_page != null
      ? "laravel"
      : "jsonapi";

  const meta =
    style === "laravel"
      ? laravel
      : { total: jsonapi.total, per_page: jsonapi.per_page, current_page: jsonapi.current_page, last_page: jsonapi.last_page, next_page_url: jsonapi.next };

  const current = typeof meta.current_page === "number" ? meta.current_page : null;
  const last    = typeof meta.last_page    === "number" ? meta.last_page    : null;
  const hasNext = (current != null && last != null && current < last) || Boolean(meta.next_page_url);

  return {
    style,
    actualPerPage: typeof meta.per_page === "number" ? meta.per_page : null,
    currentPage: current,
    lastPage: last,
    hasNext,
  };
}

/** Лише пошук (без move), з жорстким фільтром по pipeline/status коли scope=campaign */
export async function findCardSimple(args: FindArgs) {
  const scope: ScopeMode = args.scope || "global";
  const socialIdRaw = norm(args.social_id);
  const socialIdLow = low(args.social_id);
  const socialIdNoAt = socialIdLow ? stripAt(socialIdLow) : "";

  const fullNameRaw = norm(args.full_name);
  const fullNameLow = low(args.full_name);
  const socialName = low(args.social_name);

  const max_pages = Math.max(1, Math.min(50, args.max_pages ?? 3));
  const requested_page_size = Math.max(1, Math.min(100, args.page_size ?? 50));
  const strategy: Strategy = args.strategy || "both";
  const title_mode: TitleMode = args.title_mode || "exact";

  if (!TOKEN) {
    return { ok: false, error: "missing_keycrm_token", hint: "Додай KEYCRM_API_TOKEN у Vercel Env." };
  }
  if (!socialIdRaw && !fullNameRaw) {
    return { ok: false, error: "no_lookup_keys", hint: "Передай social_id або full_name." };
  }
  if (scope === "campaign" && (!args.pipeline_id || !args.status_id)) {
    return {
      ok: false,
      error: "campaign_scope_missing",
      hint: "Для scope=campaign потрібні pipeline_id і status_id.",
      used: { scope, pipeline_id: args.pipeline_id, status_id: args.status_id },
    };
  }

  let checked = 0;
  let matched: any = null;

  let pagination: "laravel" | "jsonapi" | null = null;
  let actual_page_size: number | null = null;
  let pages_scanned = 0;
  let candidates_total = 0;
  let consecutiveEmptyCandidates = 0; // рання зупинка в campaign

  for (let page = 1; page <= max_pages; page++) {
    // пробуємо laravel → jsonapi
    const r1 = await kcGet(`/pipelines/cards?page=${page}&per_page=${requested_page_size}`);
    const useR1 = r1.ok && Array.isArray(r1.json?.data);
    const resp = useR1 ? r1 : await kcGet(`/pipelines/cards?page[number]=${page}&page[size]=${requested_page_size}`);

    const rows: any[] = Array.isArray(resp.json?.data) ? resp.json.data : [];
    const meta = readMeta(resp.json);
    pagination = meta.style;
    actual_page_size = meta.actualPerPage ?? actual_page_size ?? null;

    // campaign-фільтр ТІЛЬКИ потрібна воронка+статус
    const filtered =
      scope === "campaign"
        ? rows.filter(
            (r) => r.pipeline_id === args.pipeline_id && r.status_id === args.status_id
          )
        : rows;

    // підрахунок кандидатів на сторінці
    const candidatesHere = filtered.length;
    candidates_total += candidatesHere;

    if (scope === "campaign") {
      if (candidatesHere === 0) consecutiveEmptyCandidates++;
      else consecutiveEmptyCandidates = 0;

      // якщо 2 послідовні сторінки без жодного кандидата — зупиняємось раніше
      if (consecutiveEmptyCandidates >= 2) {
        pages_scanned = page;
        break;
      }
    }

    for (const c of filtered) {
      checked++;

      const title = norm(c.title);
      const contactSocialRaw = norm(c.contact?.social_id || "");
      const contactSocialLow = low(contactSocialRaw);
      const contactSocialNoAt = contactSocialLow ? stripAt(contactSocialLow) : "";
      const contactSocialName = low(c.contact?.social_name || "");
      const contactFullNameRaw = norm(c.contact?.full_name || "");
      const contactFullNameLow = low(c.contact?.full_name || "");

      const socialHit =
        (strategy === "social" || strategy === "both") && socialIdRaw
          ? (
              // match з/без "@"
              contactSocialLow === socialIdLow ||
              contactSocialLow === `@${socialIdNoAt}` ||
              contactSocialNoAt === socialIdNoAt
            ) && (!socialName || contactSocialName === socialName)
          : false;

      const fullNameHit =
        (strategy === "full_name" || strategy === "both") && fullNameRaw
          ? contactFullNameLow === fullNameLow ||
            (title_mode === "exact"
              ? eqTitleExact(title, fullNameRaw)
              : titleContains(title, fullNameRaw))
          : false;

      if (socialHit || fullNameHit) {
        const matchedBy: Array<"social_id" | "full_name"> = [];
        if (socialHit) matchedBy.push("social_id");
        if (fullNameHit) matchedBy.push("full_name");
        matched = {
          id: c.id,
          title: c.title,
          pipeline_id: c.pipeline_id,
          status_id: c.status_id,
          contact_social: c.contact?.social_id || null,
          contact_social_name: c.contact?.social_name || null,
          contact_full_name: c.contact?.full_name || null,
          matched_by: matchedBy,
        };
        break;
      }
    }

    pages_scanned = page;
    if (matched) break;
    if (!meta.hasNext) break;
  }

  return {
    ok: true,
    social_id: socialIdRaw || null,
    full_name: fullNameRaw || null,
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
      social_name: socialName || null,
      pages_scanned,
    },
    stats: { checked, candidates_total },
    result: matched,
  };
}
