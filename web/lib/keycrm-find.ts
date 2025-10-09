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

function extractLeadRows(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.leads)) return json.leads;
  return [];
}

type CardSummary = {
  id: number | string | null;
  title: string | null;
  pipeline_id: number | string | null;
  status_id: number | string | null;
  contact_id: number | string | null;
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

function normalizeHandle(input?: string | null) {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  // replace line breaks / tabs з пробілом і візьмемо перший токен
  value = value.replace(/[\s\u00A0]+/g, " ").trim();
  if (!value) return null;

  const parts = value.split(" ");
  const preferred = parts.find((part) => /@|instagram|\.|\//.test(part)) || parts.find((part) => part.length > 2);
  value = preferred || parts[0] || value;

  value = value
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^instagram\.com\//, "")
    .replace(/^instagram[:=]/, "")
    .replace(/^instagram\s*/, "")
    .replace(/^@+/, "")
    .replace(/\?.*$/, "")
    .replace(/#.*/, "")
    .replace(/\/$/, "");

  // У деяких CRM ручних записях handle можуть містити текст на кшталт "@user, instagram".
  value = value.replace(/[,;].*$/, "");

  // Вилучаємо невалідні символи наприкінці
  value = value.replace(/[^a-z0-9._-].*$/, "");

  return value || null;
}
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

function coalesce<T>(...values: T[]): T | null {
  for (const value of values) {
    if (value === null || typeof value === "undefined") continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed as T;
      continue;
    }
    return value;
  }
  return null;
}

function extractContactFromRow(row: any, fallback?: ContactSummary | null): ContactSummary | null {
  if (!row || typeof row !== "object") {
    return fallback || null;
  }

  const candidates: any[] = [];

  const pushCandidate = (candidate: any) => {
    if (candidate && typeof candidate === "object") {
      candidates.push(candidate);
    }
  };

  pushCandidate(row.contact);
  pushCandidate(row.contact?.data);
  pushCandidate(row.client);
  pushCandidate(row.client?.data);
  pushCandidate(row.relationships?.contact?.data);
  pushCandidate(row.relationships?.contact);
  pushCandidate(row.attributes?.contact);

  const fallbackLike = {
    id:
      coalesce<any>(
        row.contact_id,
        row.contactId,
        row.contactID,
        row.client_id,
        row.clientId,
        row.attributes?.contact_id,
        row.attributes?.client_id,
        fallback?.id ?? null,
      ) ?? null,
    full_name:
      coalesce<string | null>(
        row.contact_full_name,
        row.contactFullName,
        row.client_full_name,
        row.clientFullName,
        row.client_name,
        row.clientName,
        row.full_name,
        row.name,
        row.attributes?.full_name,
        row.attributes?.contact_full_name,
        row.attributes?.client_name,
        fallback?.full_name ?? null,
      ) ?? null,
    social_id:
      coalesce<string | null>(
        row.contact_social_id,
        row.contactSocialId,
        row.client_social_id,
        row.clientSocialId,
        row.social_id,
        row.socialId,
        row.instagram_username,
        row.instagram,
        row.contact?.instagram_username,
        row.contact?.instagram,
        row.attributes?.social_id,
        row.attributes?.instagram_username,
        fallback?.social_id ?? null,
      ) ?? null,
    social_name:
      coalesce<string | null>(
        row.contact_social_name,
        row.contactSocialName,
        row.social_name,
        row.socialName,
        row.attributes?.social_name,
        fallback?.social_name ?? null,
      ) ?? null,
    social: row.contact_social ?? row.social ?? row.attributes?.social ?? null,
  };

  pushCandidate(fallbackLike);

  for (const candidate of candidates) {
    const summary = extractContactSummary(candidate);
    if (summary.social_id || summary.full_name) {
      const id =
        summary.id ??
        toNumber(row.contact_id ?? row.contactId ?? row.client_id ?? row.clientId ?? summary.id ?? null) ??
        summary.id ??
        null;
      return {
        id,
        full_name: summary.full_name,
        social_id: summary.social_id,
        social_name: summary.social_name,
      };
    }
  }

  if (fallbackLike.full_name || fallbackLike.social_id) {
    return {
      id:
        toNumber(
          fallbackLike.id ??
            row.contact_id ??
            row.contactId ??
            row.client_id ??
            row.clientId ??
            fallback?.id ??
            null,
        ) ?? fallbackLike.id ?? fallback?.id ?? null,
      full_name: norm(fallbackLike.full_name || "") || null,
      social_id: norm(fallbackLike.social_id || "") || null,
      social_name: norm(fallbackLike.social_name || "") || null,
    };
  }

  return fallback || null;
}

function cardFromRow(row: any, fallbackContact?: ContactSummary | null): CardSummary {
  const contactSummary = extractContactFromRow(row, fallbackContact);
  const rawContactId =
    row?.contact_id ??
    row?.contactId ??
    row?.client_id ??
    row?.clientId ??
    contactSummary?.id ??
    fallbackContact?.id ??
    (typeof row?.contact?.id !== "undefined" ? row?.contact?.id : null);
  return {
    id: toNumber(row?.id) ?? row?.id ?? null,
    title: norm(row?.title || row?.name) || null,
    pipeline_id: row?.pipeline_id ?? row?.pipeline?.id ?? row?.pipelineId ?? null,
    status_id: row?.status_id ?? row?.status?.id ?? row?.statusId ?? null,
    contact_id: toNumber(rawContactId) ?? rawContactId ?? null,
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
  const usernameCanonical = normalizeHandle(usernameRaw);
  const usernameNoAt = usernameCanonical || stripAt(usernameLow);

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
  let leads_pagination: "laravel" | "jsonapi" | null = null;
  let leads_actual_page_size: number | null = null;
  let leads_pages_scanned = 0;
  let candidates_total = 0;
  const attempts: Record<string, any> = {};

  const filterByScope = (row: any) => {
    if (scope !== "campaign") return true;
    if (args.pipeline_id == null || args.status_id == null) return false;
    const pipelineMatches = row?.pipeline_id != null && String(row.pipeline_id) === String(args.pipeline_id);
    const statusMatches = row?.status_id != null && String(row.status_id) === String(args.status_id);
    return pipelineMatches && statusMatches;
  };

  async function evaluateCard(row: any, fallbackContact?: ContactSummary | null) {
    const card = cardFromRow(row, fallbackContact);

    const title = norm(card.title || "");
    const contactSocialRaw = norm(card.contact?.social_id || "");
    const contactSocialLow = low(contactSocialRaw);
    const contactSocialNoAt = stripAt(contactSocialLow);
    const contactSocialCanonical = normalizeHandle(contactSocialRaw);
    const contactSocialName = low(card.contact?.social_name || "");
    const contactFullNameLow = low(card.contact?.full_name || "");

    const socialHit =
      (strategy === "social" || strategy === "both") && usernameCanonical
        ? (
            (usernameCanonical && contactSocialCanonical === usernameCanonical) ||
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
      return true;
    }

    return false;
  }

  const shouldIncludeSearch = (value?: string | null) => value && value.trim().length > 0;

  async function tryLeadSearch() {
    const leadQueries: Array<{ value: string; key: string }> = [];

    if (shouldIncludeSearch(usernameCanonical)) {
      leadQueries.push({ value: usernameCanonical as string, key: "lead_search_username" });
    }

    if (shouldIncludeSearch(usernameNoAt) && usernameNoAt !== usernameCanonical) {
      leadQueries.push({ value: usernameNoAt, key: "lead_search_username_plain" });
    }

    if (shouldIncludeSearch(fullName)) {
      leadQueries.push({ value: fullName as string, key: "lead_search_full_name" });
    }

    for (const { value, key } of leadQueries) {
      const bodyBase: Record<string, any> = { query: value };
      if (scope === "campaign") {
        if (args.pipeline_id != null) bodyBase.pipeline_id = args.pipeline_id;
        if (args.status_id != null) bodyBase.status_id = args.status_id;
      }

      const primary = await kcPost("/leads/search", bodyBase);
      attempts[key] = { method: "POST", path: "/leads/search", ok: primary.ok, status: primary.status, query: value };

      if (!primary.ok) {
        if (primary.json) {
          attempts[key].error = primary.json;
        }
        continue;
      }

      const payload = primary.json;
      const rows = extractLeadRows(payload);

      attempts[key].count = rows.length;

      leads_pagination = null;
      leads_actual_page_size = rows.length;
      leads_pages_scanned = rows.length > 0 ? 1 : 0;

      if (!rows.length) {
        continue;
      }

      const filtered = rows.filter((row) => filterByScope(row));
      candidates_total += filtered.length;

      for (const row of filtered) {
        checked++;
        const didMatch = await evaluateCard(row);
        if (didMatch) {
          return;
        }
      }
    }
  }
  async function scanCollection(source: "cards" | "leads") {
    for (let page = 1; page <= max_pages; page++) {
      const attemptKey = `${source}_page_${page}`;
      let resp: KcResponse;

      if (source === "cards") {
        const laravelQs = new URLSearchParams();
        laravelQs.set("page", String(page));
        laravelQs.set("per_page", String(requested_page_size));
        laravelQs.set("with", "contact");

        const jsonApiQs = new URLSearchParams();
        jsonApiQs.set("page[number]", String(page));
        jsonApiQs.set("page[size]", String(requested_page_size));
        jsonApiQs.set("with", "contact");

        resp = await kcGet(`/pipelines/cards?${laravelQs.toString()}`);
        attempts[attemptKey] = { method: "GET", ok: resp.ok, status: resp.status, style: "laravel" };

        if (!resp.ok) {
          const fallback = await kcGet(`/pipelines/cards?${jsonApiQs.toString()}`);
          resp = fallback;
          attempts[attemptKey] = { method: "GET", ok: resp.ok, status: resp.status, style: "jsonapi" };
        }
      } else {
        const searchValues: string[] = [];
        if (shouldIncludeSearch(usernameCanonical)) searchValues.push(usernameCanonical as string);
        if (shouldIncludeSearch(usernameNoAt) && usernameNoAt !== usernameCanonical) {
          searchValues.push(usernameNoAt);
        }
        if (shouldIncludeSearch(fullName)) searchValues.push(fullName);

        if (!searchValues.length) {
          attempts[attemptKey] = {
            method: "POST",
            path: "/leads/search",
            ok: false,
            skipped: true,
            reason: "no_search_values",
          };
          break;
        }

        const requestBody: Record<string, any> = {
          query: searchValues[0],
          page: { number: page, size: requested_page_size },
        };

        if (scope === "campaign") {
          if (args.pipeline_id != null) requestBody.pipeline_id = args.pipeline_id;
          if (args.status_id != null) requestBody.status_id = args.status_id;
        }

        resp = await kcPost("/leads/search", requestBody);
        attempts[attemptKey] = {
          method: "POST",
          path: "/leads/search",
          ok: resp.ok,
          status: resp.status,
          body: requestBody,
        };
      }

      if (!resp.ok) {
        attempts[attemptKey].error = resp.json;
        break;
      }

      const rows: any[] =
        source === "cards"
          ? (Array.isArray(resp.json?.data) ? resp.json.data : [])
          : extractLeadRows(resp.json);

      attempts[attemptKey].count = rows.length;

      const meta = readMeta(resp.json);
      if (source === "cards") {
        pagination = meta.style;
        actual_page_size = meta.actualPerPage ?? actual_page_size ?? null;
      } else {
        leads_pagination = meta.style;
        leads_actual_page_size = meta.actualPerPage ?? leads_actual_page_size ?? null;
      }

      const filtered = rows.filter((row) => filterByScope(row));
      candidates_total += filtered.length;

      for (const row of filtered) {
        checked++;
        const didMatch = await evaluateCard(row);
        if (didMatch) {
          if (source === "cards") {
            pages_scanned = page;
          } else {
            leads_pages_scanned = page;
          }
          return;
        }
      }

      if (source === "cards") {
        pages_scanned = page;
      } else {
        leads_pages_scanned = page;
      }

      if (!meta.hasNext) {
        break;
      }
    }
  }

  await tryLeadSearch();
  if (matched) {
    return {
      ok: true,
      username: usernameRaw || null,
      full_name: fullName || null,
      scope,
      used: {
        pagination: null,
        actual_page_size: null,
        requested_page_size,
        pipeline_id: args.pipeline_id ?? null,
        status_id: args.status_id ?? null,
        max_pages,
        strategy,
        title_mode,
        social_name: inputSocialName || null,
        pages_scanned,
        leads_pagination,
        leads_actual_page_size,
        leads_pages_scanned,
        contact_attempts: Object.keys(attempts).length ? attempts : null,
      },
      stats: { checked, candidates_total },
      result: matched,
    };
  }

  if (!matched) {
    await scanCollection("leads");
  }

  if (!matched) {
    await scanCollection("cards");
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
      leads_pagination,
      leads_actual_page_size,
      leads_pages_scanned,
      contact_attempts: Object.keys(attempts).length ? attempts : null,
    },
    stats: { checked, candidates_total },
    result: matched,
  };
}
