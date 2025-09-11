// lib/keycrm-find.ts
const BASE =
  (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1").replace(/\/$/, "");
const TOKEN = process.env.KEYCRM_API_TOKEN || "";

function u(path: string) {
  return `${BASE}/${path.replace(/^\//, "")}`;
}

async function kcGet(path: string) {
  const res = await fetch(u(path), {
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
  username?: string;     // contact.social_id (IG)
  full_name?: string;    // "Чат з <full_name>"
  pipeline_id?: number;  // якщо scope === "campaign"
  status_id?: number;    // якщо scope === "campaign"
  max_pages?: number;    // дефолт 3
  page_size?: number;    // дефолт 50
  strategy?: Strategy;   // дефолт both
  title_mode?: TitleMode;// дефолт exact
  scope?: ScopeMode;     // дефолт campaign (якщо є активна), інакше global
};

function norm(s?: string) {
  return (s || "").trim();
}

function eqTitle(title: string, fullName: string) {
  return title === `Чат з ${fullName}`;
}
function containsTitle(title: string, fullName: string) {
  return title.includes(fullName) || title.includes(`Чат з ${fullName}`);
}

export async function findCardSimple(args: FindArgs) {
  const scope: ScopeMode = args.scope || "global";
  const username = norm(args.username).toLowerCase();
  const fullName = norm(args.full_name);

  const max_pages = Math.max(1, Math.min(20, args.max_pages ?? 3));
  const page_size = Math.max(1, Math.min(100, args.page_size ?? 50));
  const strategy: Strategy = args.strategy || "both";
  const title_mode: TitleMode = args.title_mode || "exact";

  // в campaign-режимі pipeline_id і status_id обов'язкові
  if (scope === "campaign" && (!args.pipeline_id || !args.status_id)) {
    return {
      ok: false,
      error: "campaign_scope_missing",
      hint: "Для scope=campaign потрібні pipeline_id та status_id (їх бере API з активної кампанії або задайте у query).",
      used: { scope, pipeline_id: args.pipeline_id, status_id: args.status_id },
    };
  }

  let checked = 0;
  let matched: any = null;
  let stop = false;
  let usedStyle: "laravel" | "jsonapi" | null = null;

  for (let page = 1; page <= max_pages && !stop; page++) {
    // пробуємо дві пагінації
    const try1 = await kcGet(`/pipelines/cards?page=${page}&per_page=${page_size}`);
    const try2 =
      !try1.ok || !Array.isArray(try1.json?.data)
        ? await kcGet(`/pipelines/cards?page[number]=${page}&page[size]=${page_size}`)
        : null;

    const resp = Array.isArray(try1.json?.data) ? try1 : try2!;
    usedStyle = resp === try1 ? "laravel" : "jsonapi";

    const rows: any[] = Array.isArray(resp.json?.data) ? resp.json.data : [];
    // фільтр за campaign scope (якщо треба)
    const filtered = scope === "campaign"
      ? rows.filter(
          (r) => r.pipeline_id === args.pipeline_id && r.status_id === args.status_id
        )
      : rows;

    for (const c of filtered) {
      checked++;

      const title = norm(c.title);
      const social = norm(c.contact?.social_id).toLowerCase();

      let socialHit = false;
      let titleHit = false;

      if ((strategy === "social" || strategy === "both") && username) {
        socialHit = social && username && social === username;
      }

      if ((strategy === "title" || strategy === "both") && fullName) {
        titleHit =
          title_mode === "exact"
            ? eqTitle(title, fullName)
            : containsTitle(title, fullName);
      }

      if (socialHit || titleHit) {
        matched = {
          id: c.id,
          title: c.title,
          pipeline_id: c.pipeline_id,
          status_id: c.status_id,
          contact_social: c.contact?.social_id || null,
        };
        stop = true;
        break;
      }
    }

    if (stop) break;
    if (rows.length < page_size) break; // сторінок більше немає
  }

  return {
    ok: true,
    username: username || null,
    full_name: fullName || null,
    scope,
    used: {
      pagination: usedStyle,
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
