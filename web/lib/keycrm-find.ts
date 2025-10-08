// web/lib/keycrm-find.ts
// Пошук картки у KeyCRM з фокусом на БАЗОВУ воронку/статус (scope=campaign),
// універсальне порівняння social_id (з/без "@") і, за потреби, перевірка social_name.

const BASE = (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

function kcUrl(path: string) {
  return `${BASE}/${path.replace(/^\//, "")}`;
}
type KcResponse = { ok: boolean; status: number; json: any };

async function kcRequest(path: string, init?: RequestInit): Promise<KcResponse> {
  const res = await fetch(kcUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function kcGet(path: string) {
  return kcRequest(path);
}

async function kcPost(path: string, body: unknown) {
  return kcRequest(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

type ContactSummary = {
  id: number | string | null;
  full_name: string | null;
  social_id: string | null;
  social_name: string | null;
};

function extractContactRows(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.results)) return json.results;
  return [];
}

type CardSummary = {
  id: number | string | null;
  title: string | null;
  pipeline_id: number | string | null;
  status_id: number | string | null;
  contact: ContactSummary | null;
};

type ScopeMode = "campaign" | "global";
type Strategy = "social" | "title" | "both";
type TitleMode = "exact" | "contains";

type FindArgs = {
  username?: string;       // IG логін (без або з "@")
  full_name?: string;      // для title "Чат з <ПІБ>"
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
const toNumber = (value: any): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

function extractContactSummary(contact: any): ContactSummary {
  const socialId = norm(
    contact?.social_id ||
      contact?.social?.id ||
      contact?.instagram_username ||
      contact?.instagram?.username ||
      contact?.instagram ||
      contact?.telegram ||
      contact?.facebook ||
      contact?.viber ||
      contact?.whatsapp ||
      ""
  );

  const socialName = norm(
    contact?.social_name ||
      contact?.social?.name ||
      contact?.social?.type ||
      contact?.social_network ||
      contact?.social_networks?.[0]?.name ||
      ""
  );

  const rawId = contact?.id ?? null;

  return {
    id: toNumber(rawId) ?? (typeof rawId === "string" && rawId.trim() !== "" ? rawId : null),
    full_name: norm(contact?.full_name) || null,
    social_id: socialId || null,
    social_name: socialName || null,
  };
}

function cardFromRow(row: any, fallbackContact?: ContactSummary | null): CardSummary {
  const contactSummary = row?.contact ? extractContactSummary(row.contact) : fallbackContact || null;
  return {
    id: toNumber(row?.id) ?? row?.id ?? null,
    title: norm(row?.title) || null,
    pipeline_id: row?.pipeline_id ?? row?.pipeline?.id ?? null,
    status_id: row?.status_id ?? row?.status?.id ?? null,
    contact: contactSummary,
  };
}

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
  const usernameRaw = norm(args.username);
  const usernameLow = low(args.username);
  const usernameNoAt = stripAt(usernameLow);

  const fullName = norm(args.full_name);
  const fullNameLow = low(fullName);
  const inputSocialName = low(args.social_name);

  const max_pages = Math.max(1, Math.min(50, args.max_pages ?? 3));
  const requested_page_size = Math.max(1, Math.min(100, args.page_size ?? 50));
  const strategy: Strategy = args.strategy || "both";
  const title_mode: TitleMode = args.title_mode || "exact";

  if (!TOKEN) {
    return { ok: false, error: "missing_keycrm_token", hint: "Додай KEYCRM_API_TOKEN у Vercel Env." };
  }
  if (!usernameRaw && !fullName) {
    return { ok: false, error: "no_lookup_keys", hint: "Передай username або full_name." };
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
  let matched: CardSummary | null = null;

  let pagination: "laravel" | "jsonapi" | null = null;
  let actual_page_size: number | null = null;
  let pages_scanned = 0;
  let candidates_total = 0;
  const attempts: Record<string, any> = {};

  async function tryContactSearch() {
    const queries: Array<{
      value: string;
      attemptKey: string;
      match: (contact: ContactSummary) => boolean;
    }> = [];

    if (usernameNoAt) {
      queries.push({
        value: usernameNoAt,
        attemptKey: "contact_search",
        match: (contact) => {
          if (!contact.id || !contact.social_id) return false;
          const candidate = stripAt(low(contact.social_id));
          return candidate === usernameNoAt;
        },
      });
    }

    if (fullName) {
      const attemptKey = usernameNoAt ? "contact_search_full_name" : "contact_search";
      queries.push({
        value: fullName,
        attemptKey,
        match: (contact) => {
          if (!contact.id || !contact.full_name) return false;
          return low(contact.full_name) === fullNameLow;
        },
      });
    }

    if (!queries.length) return;

    for (const { value, attemptKey, match } of queries) {
      const encoded = encodeURIComponent(value);
      const strategies: Array<{ key: string; method: string; exec: () => Promise<KcResponse> }> = [
        { key: attemptKey, method: "POST", exec: () => kcPost("/contacts/search", { query: value }) },
        { key: `${attemptKey}_fallback`, method: "GET", exec: () => kcGet(`/contacts/search?query=${encoded}`) },
        { key: `${attemptKey}_list`, method: "GET", exec: () => kcGet(`/contacts?search=${encoded}`) },
        { key: `${attemptKey}_list_full_name`, method: "GET", exec: () => kcGet(`/contacts?full_name=${encoded}`) },
      ];

      let foundContacts: ContactSummary[] | null = null;

      for (const strategy of strategies) {
        const res = await strategy.exec();
        attempts[strategy.key] = {
          method: strategy.method,
          ok: res.ok,
          status: res.status,
          query: value,
        };

        if (!res.ok) continue;

        const contactsRaw = extractContactRows(res.json);
        const contacts = contactsRaw.map(extractContactSummary);
        attempts[strategy.key].contacts = contacts;

        const matchingContacts = contacts.filter(match);
        attempts[strategy.key].matches = matchingContacts;

        if (matchingContacts.length === 0) {
          continue;
        }

        foundContacts = matchingContacts;
        break;
      }

      if (!foundContacts || foundContacts.length === 0) {
        continue;
      }

      for (const contact of foundContacts) {
        if (!contact.id) continue;

        const cards = await kcGet(`/contacts/${contact.id}/cards`);
        const entryKey = `contact_${contact.id}_cards`;
        attempts[entryKey] = { ok: cards.ok, status: cards.status };
        if (!cards.ok) continue;

        const rows: any[] = Array.isArray(cards.json?.data) ? cards.json.data : [];
        attempts[entryKey].count = rows.length;

        const filtered = rows.filter((row) => {
          if (scope !== "campaign") return true;
          if (args.pipeline_id == null || args.status_id == null) return false;
          const pipelineMatches = row?.pipeline_id != null && String(row.pipeline_id) === String(args.pipeline_id);
          const statusMatches = row?.status_id != null && String(row.status_id) === String(args.status_id);
          return pipelineMatches && statusMatches;
        });

        candidates_total += filtered.length;

        for (const row of filtered) {
          checked++;
          const card = cardFromRow(row, contact);
          const socialId = card.contact?.social_id ? stripAt(low(card.contact.social_id)) : null;
          const contactSocialNameLow = low(card.contact?.social_name || "");
          const contactFullNameLow = low(card.contact?.full_name || "");
          const socialHit =
            (strategy === "social" || strategy === "both") && usernameRaw
              ? socialId === usernameNoAt && (!inputSocialName || !contactSocialNameLow || contactSocialNameLow === inputSocialName)
              : false;

          const title = card.title || "";
          const titleHit =
            (strategy === "title" || strategy === "both") && fullName
              ? title_mode === "exact"
                ? eqTitleExact(title, fullName)
                : titleContains(title, fullName)
              : false;

          const nameHit = fullNameLow ? contactFullNameLow === fullNameLow : false;

          if (socialHit || titleHit || nameHit) {
            matched = card;
            return;
          }
        }

        if (matched) return;
      }
    }
  }

  await tryContactSearch();
  if (matched) {
    return {
      ok: true,
      username: usernameRaw || null,
      full_name: fullName || null,
      scope,
      used: {
        strategy,
        title_mode,
        social_name: inputSocialName || null,
        max_pages,
        requested_page_size,
        pipeline_id: args.pipeline_id ?? null,
        status_id: args.status_id ?? null,
        pagination: null,
        actual_page_size: null,
        pages_scanned,
        contact_attempts: attempts,
      },
      stats: { checked, candidates_total },
      result: matched,
    };
  }
  for (let page = 1; page <= max_pages; page++) {
    const laravelQs = new URLSearchParams();
    laravelQs.set('page', String(page));
    laravelQs.set('per_page', String(requested_page_size));

    const jsonApiQs = new URLSearchParams();
    jsonApiQs.set('page[number]', String(page));
    jsonApiQs.set('page[size]', String(requested_page_size));

    // пробуємо laravel → jsonapi без форс-фільтрів (KeyCRM може ігнорувати їх в одному зі стилів)
    const r1 = await kcGet(`/pipelines/cards?${laravelQs.toString()}`);
    const useR1 = r1.ok && Array.isArray(r1.json?.data);
    const resp = useR1 ? r1 : await kcGet(`/pipelines/cards?${jsonApiQs.toString()}`);

    const rows: any[] = Array.isArray(resp.json?.data) ? resp.json.data : [];
    const meta = readMeta(resp.json);
    pagination = meta.style;
    actual_page_size = meta.actualPerPage ?? actual_page_size ?? null;

    // campaign-фільтр ТІЛЬКИ потрібна воронка+статус
    const filtered =
      scope === "campaign"
        ? rows.filter((r) => {
            if (args.pipeline_id == null || args.status_id == null) return false;
            const pipelineMatches =
              r?.pipeline_id != null && String(r.pipeline_id) === String(args.pipeline_id);
            const statusMatches =
              r?.status_id != null && String(r.status_id) === String(args.status_id);
            return pipelineMatches && statusMatches;
          })
        : rows;

    // підрахунок кандидатів на сторінці
    const candidatesHere = filtered.length;
    candidates_total += candidatesHere;

    for (const c of filtered) {
      checked++;

      const card = cardFromRow(c);
      const title = norm(card.title || "");
      const contactSocialRaw = norm(card.contact?.social_id || "");
      const contactSocialLow = low(contactSocialRaw);
      const contactSocialNoAt = stripAt(contactSocialLow);
      const contactSocialName = low(card.contact?.social_name || "");
      const contactFullNameLow = low(card.contact?.full_name || "");

      const socialHit =
        (strategy === "social" || strategy === "both") && usernameRaw
          ? (
              // match з/без "@"
              contactSocialLow === usernameLow ||
              contactSocialLow === `@${usernameNoAt}` ||
              contactSocialNoAt === usernameNoAt
            ) && (!inputSocialName || !contactSocialName || contactSocialName === inputSocialName)
          : false;

      const titleHit =
        (strategy === "title" || strategy === "both") && fullName
          ? title_mode === "exact"
            ? eqTitleExact(title, fullName)
            : titleContains(title, fullName)
          : false;

      const nameHit = fullNameLow ? contactFullNameLow === fullNameLow : false;

      if (socialHit || titleHit || nameHit) {
        matched = card;
        break;
      }
    }

    pages_scanned = page;
    if (matched) break;
    if (!meta.hasNext) break;
  }

  return {
    ok: true,
    username: usernameRaw || null,
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
      social_name: inputSocialName || null,
      pages_scanned,
      contact_attempts: Object.keys(attempts).length ? attempts : null,
    },
    stats: { checked, candidates_total },
    result: matched,
  };
}
