// web/app/api/mc/manychat/route.ts
// ManyChat → (rules) → local KV find (in base pair) → move card in KeyCRM
// Лічильник: campaigns:{id}.moved_count (тільки при УСПІШНОМУ реальному переміщенні)
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

/* ───────────────────────── Auth: MC token ───────────────────────── */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const p of header.split(/;\s*/)) {
    const [k, ...rest] = p.split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
function extractBearer(req: Request, name: string) {
  const url = new URL(req.url);
  const q = url.searchParams.get(name);
  if (q) return q;

  const auth = req.headers.get("authorization");
  if (auth && /^bearer /i.test(auth)) return auth.replace(/^bearer /i, "").trim();

  const x = req.headers.get(`x-${name.replace(/_/g, "-")}`);
  if (x) return x;

  const cookieHeader = req.headers.get("cookie");
  const c = readCookie(cookieHeader, name.toLowerCase());
  if (c) return c;
  return null;
}
function ensureMc(req: Request) {
  const want = process.env.MC_TOKEN;
  const got = extractBearer(req, "MC_TOKEN");
  if (!want || got !== want) {
    const err = new Error("Unauthorized");
    // @ts-ignore
    err.status = 401;
    throw err;
  }
}

/* ───────────────────────── Types ───────────────────────── */
type Rule = {
  enabled?: boolean;
  field?: "text";
  op?: "contains" | "equals";
  value?: string;
};
type Campaign = {
  id: number;
  name?: string;
  active?: boolean;

  // базова пара для пошуку
  base_pipeline_id: number | string;
  base_status_id: number | string;

  // куди рухати (може бути порожньо → не рухаємо)
  to_pipeline_id?: number | string | null;
  to_status_id?: number | string | null;

  // правила
  rules?: { v1?: Rule; v2?: Rule };

  // мітки видалення/деактивації
  deleted?: boolean;
  is_deleted?: boolean;
  deleted_at?: string | null;

  // лічильник ефективності
  moved_count?: number;
};

type Card = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name?: string | null;
  updated_at: string;
};

/* ───────────────────────── Normalize helpers ───────────────────────── */
function normHandle(v?: string | null) {
  if (!v) return undefined;
  return String(v).trim().replace(/^@/, "").toLowerCase();
}
function normText(v?: string | null) {
  return (v ?? "").toString();
}
function normFullname(a?: string | null, b?: string | null, c?: string | null) {
  const s = (a && a.trim()) || (b && b.trim()) || [c, ""].filter(Boolean).join(" ").trim();
  return s || undefined;
}
function ciIncludes(hay?: string | null, needle?: string | null) {
  if (!hay || !needle) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}
function eqCI(a?: string | null, b?: string | null) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}
function toEpoch(s?: string | null) {
  const ts = s ? Date.parse(s) : NaN;
  return Number.isFinite(ts) ? ts : Date.now();
}
function parseCard(raw: unknown): Card | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Card; } catch { return null; }
  }
  return raw as Card;
}

/* ───────────────────────── KV: campaigns ───────────────────────── */
async function listActiveCampaigns(): Promise<Campaign[]> {
  const ids = (await kvZRange("campaigns:index", 0, -1)) as string[] | undefined;
  if (!ids?.length) return [];
  const out: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    let obj: Campaign | null = null;
    try {
      obj = typeof raw === "string" ? (JSON.parse(raw) as Campaign) : (raw as Campaign);
    } catch {
      obj = null;
    }
    if (!obj) continue;
    if (obj.deleted || obj.is_deleted || obj.deleted_at) continue;
    if (!obj.active) continue;
    if (obj.base_pipeline_id == null || obj.base_status_id == null) continue;
    out.push(obj);
  }
  return out;
}

// інкрементуємо moved_count тільки при реальному успішному переміщенні
async function bumpCampaignMoved(campaignId: number) {
  const key = `campaigns:${campaignId}`;
  const raw = await kvGet(key);
  if (!raw) return;
  let obj: Campaign;
  try {
    obj = typeof raw === "string" ? (JSON.parse(raw) as Campaign) : (raw as Campaign);
  } catch {
    return;
  }
  const current = Number(obj.moved_count ?? 0);
  obj.moved_count = Number.isFinite(current) ? current + 1 : 1;
  // опціонально: оновити updated_at, якщо є така властивість
  (obj as any).updated_at = new Date().toISOString();

  // 🔧 FIX: kvSet очікує string → серіалізуємо
  await kvSet(key, JSON.stringify(obj));
}

/* ───────────────────────── Rules match ───────────────────────── */
function matchRule(text: string, rule?: Rule): boolean {
  const r = rule ?? {};
  if (r.enabled === false) return false;
  const value = (r.value ?? "").toString().trim();
  if (!value) return false;
  const t = text.toString();
  if (r.op === "equals") return eqCI(t, value);
  // default: contains (CI)
  return ciIncludes(t, value);
}

/* ───────────────────────── Local search in base pair ───────────────────────── */
async function findByUsernameInPair(username: string, p: string, s: string) {
  const handle = normHandle(username);
  if (!handle) return null;

  const keyA = `kc:index:social:instagram:${handle}`;
  const keyB = `kc:index:social:instagram:@${handle}`;

  const idsA = (await kvZRange(keyA, -100, -1)) as string[] | undefined;
  const idsB = (await kvZRange(keyB, -100, -1)) as string[] | undefined;

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const arr of [idsA ?? [], idsB ?? []]) {
    for (const id of arr) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  if (!merged.length) return null;

  let best: { card: Card; score: number } | null = null;
  for (const id of merged) {
    const raw = await kvGet(`kc:card:${id}`);
    const card = parseCard(raw);
    if (!card) continue;
    if (String(card.pipeline_id) !== p || String(card.status_id) !== s) continue;
    const score = toEpoch(card.updated_at);
    if (!best || score > best.score) best = { card, score };
  }
  return best?.card ?? null;
}

async function findByFullnameInPair(fullname: string, p: string, s: string) {
  const indexKey = `kc:index:cards:${p}:${s}`;
  const ids = (await kvZRange(indexKey, -200, -1)) as string[] | undefined;
  if (!ids?.length) return null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    const raw = await kvGet(`kc:card:${id}`);
    const card = parseCard(raw);
    if (!card) continue;
    if (
      ciIncludes(card.contact_full_name ?? undefined, fullname) ||
      ciIncludes(card.title, fullname)
    ) {
      return card;
    }
  }
  return null;
}

/* ───────────────────────── KeyCRM move (inline) ───────────────────────── */
async function kcMoveCard(cardId: number | string, toPipeline?: string | number | null, toStatus?: string | number | null) {
  const base = process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1";
  const token = process.env.KEYCRM_API_TOKEN;
  if (!token) throw new Error("KeyCRM token not set");

  const body: Record<string, any> = {};
  if (toPipeline != null) body.pipeline_id = Number(toPipeline);
  if (toStatus != null) body.status_id = Number(toStatus);

  // якщо нема що рухати — не вважаємо це переміщенням
  if (Object.keys(body).length === 0) {
    return { ok: true, status: 204, data: null, noAction: true as const };
  }

  const res = await fetch(`${base}/pipelines/cards/${cardId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  let data: any = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data, noAction: false as const };
}

/* ───────────────────────── Route: POST /api/mc/manychat ───────────────────────── */
export async function POST(req: Request) {
  try {
    ensureMc(req);

    // 1) Read & normalize MC payload
    const payload = await req.json().catch(() => ({}));
    const username = normHandle(payload?.username);
    const text = normText(payload?.text);
    const fullname =
      normFullname(payload?.full_name, payload?.name, `${payload?.first_name ?? ""} ${payload?.last_name ?? ""}`);

    // 2) Find exactly one active campaign matched by rules (V1 is mandatory; V2 optional)
    const campaigns = await listActiveCampaigns();
    let matched: Campaign | undefined;

    for (const c of campaigns) {
      const v1ok = matchRule(text, c.rules?.v1);
      if (!v1ok) continue;
      // якщо є V2 з value — теж мусить пройти
      const v2 = c.rules?.v2;
      if (v2 && (v2.value ?? "").toString().trim()) {
        if (!matchRule(text, v2)) continue;
      }
      matched = c;
      break;
    }

    if (!matched) {
      return NextResponse.json(
        { ok: false, reason: "no_campaign_match", payload: { username, text, fullname } },
        { status: 200 }
      );
    }

    const p = String(matched.base_pipeline_id);
    const s = String(matched.base_status_id);

    // 3) Local KV search strictly in the base pair
    let card: Card | null = null;
    let matched_by: "username" | "fullname" | "none" = "none";

    if (username) {
      card = await findByUsernameInPair(username, p, s);
      if (card) matched_by = "username";
    }
    if (!card && fullname) {
      card = await findByFullnameInPair(fullname, p, s);
      if (card) matched_by = "fullname";
    }

    if (!card) {
      return NextResponse.json(
        {
          ok: false,
          reason: "card_not_found_in_pair",
          campaign: { id: matched.id, name: matched.name, base_pipeline_id: p, base_status_id: s },
          search: { matched_by, username, fullname },
        },
        { status: 200 }
      );
    }

    // 4) Move in KeyCRM (count only REAL successful moves)
    const toP = matched.to_pipeline_id ?? null;
    const toS = matched.to_status_id ?? null;

    const moveRes = await kcMoveCard(card.id, toP, toS);

    if (moveRes.ok && !moveRes.noAction) {
      await bumpCampaignMoved(matched.id);
    }

    return NextResponse.json(
      {
        ok: moveRes.ok,
        status: moveRes.status,
        moved_count_incremented: Boolean(moveRes.ok && !moveRes.noAction),
        campaign: {
          id: matched.id,
          name: matched.name,
          base_pipeline_id: p,
          base_status_id: s,
          to_pipeline_id: toP,
          to_status_id: toS,
        },
        card: {
          id: card.id,
          title: card.title,
          pipeline_id: card.pipeline_id,
          status_id: card.status_id,
          contact_social_name: card.contact_social_name,
          contact_social_id: card.contact_social_id,
          contact_full_name: card.contact_full_name ?? null,
          updated_at: card.updated_at,
        },
        search: { matched_by, username, fullname },
        keycrm: moveRes.data ?? null,
      },
      { status: moveRes.ok ? 200 : 502 }
    );
  } catch (e: any) {
    const status = e?.status ?? 500;
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status });
  }
}
