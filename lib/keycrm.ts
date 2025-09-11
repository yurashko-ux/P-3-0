// lib/keycrm.ts
type KCAuth = { baseUrl: string; token: string };
const kcAuth = (): KCAuth => ({
  baseUrl: process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1",
  token: process.env.KEYCRM_API_TOKEN || "",
});

function kcHeaders() {
  const { token } = kcAuth();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

type Scope = { pipeline_id: number; status_id: number };

function pickContainer(json: any): any[] {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  return [];
}

function pageMeta(json: any, fallbackPer = 50, page = 1) {
  const total = json?.total ?? json?.meta?.total ?? null;
  const per = json?.per_page ?? json?.meta?.per_page ?? fallbackPer;
  const current = json?.current_page ?? json?.meta?.current_page ?? page;
  const last =
    json?.last_page ??
    json?.meta?.last_page ??
    (total && per ? Math.ceil(total / per) : null);
  return { total, per, current, last };
}

function norm(s?: string) {
  return (s || "").trim().toLowerCase();
}
function normTitle(fullname?: string) {
  const n = norm(fullname);
  return n ? `чат з ${n}` : "";
}

// Токенізація імені (літери/цифри), юнікод-безпечно
function nameTokens(s?: string): string[] {
  const n = norm(s);
  if (!n) return [];
  return n.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
function tokensContainAll(hay: string[], needles: string[]) {
  if (!hay.length || !needles.length) return false;
  const set = new Set(hay);
  return needles.every(n => set.has(n));
}

/**
 * Розширений пошук картки ЛИШЕ в базовій воронці/статусі активної кампанії.
 * Порядок стратегій:
 * 1) contact.social_id === username (IG логін без "@")
 * 2) title містить "чат з <ПІБ>"
 * 3) contact.full_name дорівнює full_name або містить обидва токени first/last
 * 4) contact.client.full_name дорівнює full_name або містить обидва токени first/last
 */
export async function kcFindCardIdInBase(opts: {
  username?: string;
  fullname?: string;
  first_name?: string;
  last_name?: string;
  scope: Scope;
}): Promise<{ ok: boolean; card_id: number | null; strategy: string; checked: number }> {
  const { baseUrl } = kcAuth();
  const headers = kcHeaders();
  const username = norm(opts.username);
  const wantTitle = normTitle(opts.fullname);

  const wantFull = norm(opts.fullname);
  const fTok = nameTokens(opts.first_name);
  const lTok = nameTokens(opts.last_name);
  const wantTokens = [...new Set([...fTok, ...lTok])]; // унікальні токени first+last

  const { pipeline_id, status_id } = opts.scope;

  const PER = Number(process.env.KEYCRM_PER_PAGE || 50);
  const MAX_PAGES = Number(process.env.KEYCRM_MAX_PAGES || 3);

  let page = 1;
  let checked = 0;

  while (page <= MAX_PAGES) {
    const url = new URL(`${baseUrl}/pipelines/cards`);
    url.searchParams.set("pipeline_id", String(pipeline_id));
    url.searchParams.set("status_id", String(status_id));
    url.searchParams.set("per_page", String(PER));
    url.searchParams.set("page", String(page));
    if (username) url.searchParams.set("search", username);

    const res = await fetch(url.toString(), { headers, cache: "no-store" });
    if (!res.ok) break;

    const json = await res.json();
    const items = pickContainer(json);

    for (const c of items) {
      checked++;
      const contact = c?.contact ?? {};
      const social = norm(contact?.social_id);
      const title = norm(c?.title);
      const contactFull = norm(contact?.full_name);
      const clientFull = norm(contact?.client?.full_name);

      // 1) IG username у contact.social_id
      if (username && social === username) {
        return { ok: true, card_id: Number(c.id), strategy: "contact.social_id", checked };
      }

      // 2) title: "чат з <ПІБ>"
      if (wantTitle && title.includes(wantTitle)) {
        return { ok: true, card_id: Number(c.id), strategy: "title", checked };
      }

      // 3) contact.full_name — повне співпадіння або токени
      if (contactFull) {
        if (wantFull && contactFull === wantFull) {
          return { ok: true, card_id: Number(c.id), strategy: "contact.full_name", checked };
        }
        if (wantTokens.length) {
          const hay = nameTokens(contactFull);
          if (tokensContainAll(hay, wantTokens)) {
            return { ok: true, card_id: Number(c.id), strategy: "contact.full_name_tokens", checked };
          }
        }
      }

      // 4) contact.client.full_name — повне співпадіння або токени
      if (clientFull) {
        if (wantFull && clientFull === wantFull) {
          return { ok: true, card_id: Number(c.id), strategy: "client.full_name", checked };
        }
        if (wantTokens.length) {
          const hay = nameTokens(clientFull);
          if (tokensContainAll(hay, wantTokens)) {
            return { ok: true, card_id: Number(c.id), strategy: "client.full_name_tokens", checked };
          }
        }
      }
    }

    const meta = pageMeta(json, PER, page);
    if (!meta.last || meta.current >= meta.last) break;
    page++;
  }

  return { ok: false, card_id: null, strategy: "not-found", checked };
}
