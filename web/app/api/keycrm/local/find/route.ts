// web/app/api/keycrm/local/find/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

/* ───────────────────────── Admin guard (inline) ───────────────────────── */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const p of header.split(/;\s*/)) {
    const [k, ...rest] = p.split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
function extractAdminPass(req: Request): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("admin");
  if (q) return q;

  const auth = req.headers.get("authorization");
  if (auth && /^bearer /i.test(auth)) return auth.replace(/^bearer /i, "").trim();

  const x = req.headers.get("x-admin-pass");
  if (x) return x;

  const cookieHeader = req.headers.get("cookie");
  const c = readCookie(cookieHeader, "admin_pass");
  if (c) return c;
  return null;
}
function ensureAdmin(req: Request) {
  const want = process.env.ADMIN_PASS;
  const got = extractAdminPass(req);
  if (!want || got !== want) throw new Error("Unauthorized");
}

/* ───────────────────────── Helpers ───────────────────────── */
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

function normHandle(v?: string | null) {
  if (!v) return undefined;
  return String(v).trim().replace(/^@/, "").toLowerCase();
}
function ciIncludes(hay: string | undefined | null, needle: string | undefined | null) {
  if (!hay || !needle) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
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

/* ───────────────────────── Core search ───────────────────────── */
async function findByUsernameInPair(username: string, p: string, s: string) {
  // індекси для IG: і без @, і з @
  const handle = normHandle(username);
  if (!handle) return null;

  const keyA = `kc:index:social:instagram:${handle}`;
  const keyB = `kc:index:social:instagram:@${handle}`;

  // забираємо останні 100 id з кожного індексу
  const idsA = (await kvZRange(keyA, -100, -1)) as string[] | undefined;
  const idsB = (await kvZRange(keyB, -100, -1)) as string[] | undefined;

  const seen = new Set<string>();
  const merged = [] as string[];
  for (const arr of [idsA ?? [], idsB ?? []]) {
    for (const id of arr) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  if (merged.length === 0) return null;

  // фільтруємо по базовій парі; беремо найновішу за updated_at
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
  const cardsKey = `kc:index:cards:${p}:${s}`;
  // візьмемо останні 200 карток з базової пари
  const ids = (await kvZRange(cardsKey, -200, -1)) as string[] | undefined;
  if (!ids?.length) return null;

  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    const raw = await kvGet(`kc:card:${id}`);
    const card = parseCard(raw);
    if (!card) continue;
    const hit =
      ciIncludes(card.contact_full_name ?? null, fullname) ||
      ciIncludes(card.title, fullname);
    if (hit) return card;
  }
  return null;
}

/* ───────────────────────── Route ───────────────────────── */
export async function GET(req: Request) {
  try {
    ensureAdmin(req);
    const url = new URL(req.url);

    const p = url.searchParams.get("pipeline_id");
    const s = url.searchParams.get("status_id");
    if (!p || !s) {
      return NextResponse.json(
        { ok: false, error: "pipeline_id and status_id are required" },
        { status: 400 }
      );
    }

    const username = url.searchParams.get("username") ?? undefined;
    const fullname = url.searchParams.get("fullname") ?? undefined;

    let by = null as "username" | "fullname" | null;
    let card: Card | null = null;

    if (username) {
      card = await findByUsernameInPair(username, String(p), String(s));
      if (card) by = "username";
    }
    if (!card && fullname) {
      card = await findByFullnameInPair(fullname, String(p), String(s));
      if (card) by = "fullname";
    }

    return NextResponse.json({
      ok: true,
      matched_by: by,
      pipeline_id: p,
      status_id: s,
      card: card ?? null,
    });
  } catch (e: any) {
    const msg = e?.message || "failed";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
