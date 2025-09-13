// web/app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

/**
 * ManyChat sends (examples):
 * {
 *  "username": "{{ig_username}}",
 *  "text": "{{last_input_text}}",
 *  "full_name": "{{full_name}}",
 *  "name":"{{full_name}}",
 *  "first_name":"{{first_name}}",
 *  "last_name":"{{last_name}}"
 * }
 *
 * Test call:
 *  POST /api/mc/manychat?pipeline_id=1&status_id=38&token=YOUR_MC_TOKEN
 */

function normHandle(raw?: string | null) {
  if (!raw) return "";
  return String(raw).trim().replace(/^@/, "").toLowerCase();
}
function normFullname(p: {
  full_name?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  const direct = (p.full_name || p.name || "").trim();
  if (direct) return direct;
  const fn = (p.first_name || "").trim();
  const ln = (p.last_name || "").trim();
  return [fn, ln].filter(Boolean).join(" ").trim();
}
function includesCI(hay: string | null | undefined, needle: string) {
  if (!hay || !needle) return false;
  return hay.toLowerCase().includes(needle.toLowerCase());
}
function parseMaybeJson<T = any>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

async function assertMc(req: Request) {
  const u = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-mc-token") ||
    u.searchParams.get("token") ||
    "";
  const expected = (process.env.MC_TOKEN || "").trim();
  const adminBypass =
    (u.searchParams.get("admin") || "") === (process.env.ADMIN_PASS || "");

  if (!expected && !adminBypass) {
    return { ok: false as const, error: "MC_TOKEN is not configured" };
  }
  if (adminBypass) return { ok: true as const };
  if (provided && expected && provided === expected) return { ok: true as const };
  return { ok: false as const, error: "Unauthorized" };
}

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

async function listActiveBasePairsFromKV(): Promise<Array<{ p: string; s: string; id?: string }>> {
  const out: Array<{ p: string; s: string; id?: string }> = [];
  // читаємо до 500 кампаній з індексу (якщо менше — просто поверне скільки є)
  const ids = ((await kvZRange("campaigns:index", 0, 499)) as any[]) ?? [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = parseMaybeJson<any>(raw);
    if (!c) continue;
    // tolerant mapping of fields
    const active =
      c.active ?? c.enabled ?? c.is_active ?? c.status === "active" ?? true;
    const p =
      c.base_pipeline_id ??
      c.pipeline_id ??
      c.base?.pipeline_id ??
      c.scope?.pipeline_id ??
      null;
    const s =
      c.base_status_id ??
      c.status_id ??
      c.base?.status_id ??
      c.scope?.status_id ??
      null;

    if (active && p != null && s != null) {
      out.push({ p: String(p), s: String(s), id: String(id) });
    }
  }
  return out;
}

async function localFindInPair({
  pipeline_id,
  status_id,
  username,
  fullname,
  limit = 200,
}: {
  pipeline_id: string;
  status_id: string;
  username?: string;
  fullname?: string;
  limit?: number;
}) {
  const pairIndex = `kc:index:cards:${pipeline_id}:${status_id}`;

  // 1) try social handle (instagram)
  const handle = normHandle(username || "");
  if (handle) {
    const socialKeys = [
      `kc:index:social:instagram:${handle}`,
      `kc:index:social:instagram:@${handle}`,
    ];
    const checked = new Set<string>();
    for (const sk of socialKeys) {
      const members = ((await kvZRange(sk, 0, limit - 1)) as any[]) ?? [];
      for (const m of members) {
        const id = String(m);
        if (checked.has(id)) continue;
        checked.add(id);
        const raw = await kvGet(`kc:card:${id}`);
        const card = parseMaybeJson<Card>(raw);
        if (!card) continue;
        if (
          String(card.pipeline_id ?? "") === pipeline_id &&
          String(card.status_id ?? "") === status_id
        ) {
          return { source: "social", card };
        }
      }
    }
  }

  // 2) fallback by fullname/title within the pair
  const name = (fullname || "").trim();
  if (name) {
    const members = ((await kvZRange(pairIndex, 0, limit - 1)) as any[]) ?? [];
    // перевіряємо з «кінця» (новіші з вищим score наприкінці масиву)
    for (let i = members.length - 1; i >= 0; i--) {
      const id = String(members[i]);
      const raw = await kvGet(`kc:card:${id}`);
      const card = parseMaybeJson<Card>(raw);
      if (!card) continue;
      if (
        includesCI(card.contact_full_name ?? null, name) ||
        includesCI(card.title ?? "", name)
      ) {
        return { source: "fullname/title", card };
      }
    }
  }

  return { source: null as const, card: null as Card | null };
}

export async function POST(req: Request) {
  // 1) Guard
  const auth = await assertMc(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  // 2) Parse body (json or form-data)
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    try {
      const fd = await req.formData();
      body = Object.fromEntries(fd.entries());
    } catch {
      body = {};
    }
  }

  // 3) Normalize ManyChat payload
  const username = normHandle(
    body.username || body.ig_username || body.handle || ""
  );
  const text = String(body.text || body.last_input_text || "").trim();
  const fullname = normFullname({
    full_name: body.full_name,
    name: body.name,
    first_name: body.first_name,
    last_name: body.last_name,
  });

  // 4) Determine base pairs to search
  const url = new URL(req.url);
  const qpPipeline = url.searchParams.get("pipeline_id");
  const qpStatus = url.searchParams.get("status_id");

  let pairs: Array<{ p: string; s: string; id?: string }> = [];
  if (qpPipeline && qpStatus) {
    pairs = [{ p: String(qpPipeline), s: String(qpStatus) }];
  } else {
    pairs = await listActiveBasePairsFromKV();
  }
  if (!pairs.length) {
    return NextResponse.json(
      { ok: false, error: "No base pairs to search (provide ?pipeline_id&status_id or configure active campaigns)" },
      { status: 400 }
    );
  }

  // 5) Try to find a card in any pair (first hit wins)
  for (const pair of pairs) {
    const { source, card } = await localFindInPair({
      pipeline_id: pair.p,
      status_id: pair.s,
      username,
      fullname,
    });
    if (card) {
      return NextResponse.json({
        ok: true,
        match: { pair: { pipeline_id: pair.p, status_id: pair.s }, source, card },
        input: { username, fullname, text },
      });
    }
  }

  // 6) Not found
  return NextResponse.json({
    ok: true,
    match: null,
    input: { username, fullname, text },
  });
}
