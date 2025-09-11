// web/lib/keycrm-find.ts
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
  username?: string;     // contact.social_id (IG логін, без "@")
  full_name?: string;    // шукаємо у title як "Чат з <full_name>"
  pipeline_id?: number;  // якщо scope === "campaign"
  status_id?: number;    // якщо scope === "campaign"
  max_pages?: number;    // дефолт 3
  page_size?: number;    // дефолт 50
  strategy?: Strategy;   // дефолт both
  title_mode?: TitleMode;// дефолт exact
  scope?: ScopeMode;     // дефолт global (для campaign обовʼязково pipeline_id і status_id)
};

function norm(s?: string) {
  return (s || "").trim();
}

function eqTitle(title: string, fullName: string) {
  return title === `Чат з ${fullName}`;
}
function containsTitle(title: string, fullName: string) {
  const hay = title.toLowerCase();
  const fn = fullName.toLowerCase();
  return hay.includes(fn) || hay.includes(`чат з ${fn}`);
}

/** Простий пошук картки. НІЯКИХ переміщень — тільки знаходимо та повертаємо збіг. */
export async function findCardSimple(args: FindArgs) {
  const scope: ScopeMode = args.scope || "global";
  const username = norm(args.username).toLowerCase();
  const fullName = norm(args.full_name);

  const max_pages = Math.max(1, Math.min(50, args.max_pages ?? 3));
  const page_size = Math.max(1, Math.min(100, args.page_size ?? 50));
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

  for (let page = 1; page <= max_pages; page++) {
    // Варіант 1: ?page= & per_page=
    const r1 = await kcGet(`/pipelines/cards?page=${page}&per_page=${page_size}`);
    const ok1 = r1.ok && Array.isArray(r1.json?.data);
    // Варіант 2: ?page[number]= & page[size]=
    const r2 = ok1 ? null : await kcGet(`/pipelines/cards?page[number]=${page}&page[size]=${page_size}`);

    const resp = ok1 ? r1 : r2!;
    pagination = ok1 ? "laravel" : "jsonapi";

    const rows: any[] = Array.isArray(resp.json?.data) ? resp.json.data : [];
    const filtered =
      scope === "campaign"
        ? rows.filter(
            (r) => r.pipeline_id === args.pipeline_id && r.status_id === args.status_id
          )
        : rows;

    for (const c of filtered) {
      checked++;
      const title = norm(c.title);
      const social = norm(c.contact?.social_id).toLowerCase();

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

    if (matched) break;
    if (rows.length < page_size) break; // більше сторінок немає
  }

  return {
    ok: true,
    username: username || null,
    full_name: fullName || null,
    scope,
    used: {
      pagination,
      pipeline_id: args.pipeline_id ?? null,
      status_id: args.status_id ?? null,
      max_pages,
      page_size,
      strategy,
      title_mode,
    },
    result: matched,
    checked,
  };
}
