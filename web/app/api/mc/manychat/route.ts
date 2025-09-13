// web/app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";
import { kcMoveCard } from "@/lib/keycrm";

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
 * Test:
 *  POST /api/mc/manychat?admin=ADMIN_PASS&apply=0
 *  Body(JSON): {"username":"@handle","text":"привіт","full_name":"Імʼя Прізвище"}
 *  Для реального руху: ?apply=1
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
  if (adminBypass) return { ok: true as const, admin: true as const };
  if (provided && expected && provided === expected) return { ok: true as const, admin: false as const };
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

type Campaign = {
  id: string;
  name?: string;
  base_pipeline_id: string;
  base_status_id: string;
  to_pipeline_id?: string | null;
  to_status_id?: string | null;
  rules?: {
    v1?: {
      enabled?: boolean;
      field?: "text";
      op?: "contains" | "equals";
      value?: string;
    };
  };
};

async function listActiveCampaignsDetailed(): Promise<Campaign[]> {
  const out: Campaign[] = [];
  const ids = ((await kvZRange("campaigns:index", 0, 999)) as any[]) ?? [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = parseMaybeJson<any>(raw);
    if (!c) continue;

    // FIX: прибрано "never nullish" — робимо частину, що може дати undefined
    const active =
      (c.active ?? c.enabled ?? c.is_active) ??
      (typeof c.status === "string" ? (c.status.toLowerCase() === "active") : undefined) ??
      true;

    const base_pipeline_id =
      c.base_pipeline_id ??
      c.pipeline_id ??
      c.base?.pipeline_id ??
      c.scope?.pipeline_id ??
      null;

    const base_status_id =
      c.base_status_id ??
      c.status_id ??
      c.base?.status_id ??
      c.scope?.status_id ??
      null;

    // куди рухати при збігу правила (target)
    const to_pipeline_id =
      c.to_pipeline_id ?? c.move_to_pipeline_id ?? c.to?.pipeline_id ?? null;
    const to_status_id =
      c.to_status_id ?? c.move_to_status_id ?? c.to?.status_id ?? null;

    const v1 = c.rules?.v1 ?? {
      enabled: true,
      field: "text",
      op: "contains",
      value: "",
    };

    if (
      active &&
      base_pipeline_id != null &&
      base_status_id != null
    ) {
      out.push({
        id: String(id),
        name: c.name ?? c.title ?? undefined,
        base_pipeline_id: String(base_pipeline_id),
        base_status_id: String(base_status_id),
        to_pipeline_id: to_pipeline_id != null ? String(to_pipeline_id) : null,
        to_status_id: to_status_id != null ? String(to_status_id) : null,
        rules: { v1 },
      });
    }
  }
  return out;
}

function matchV1(text: string, rule?: Campaign["rules"]["v1"]) {
  const r = rule ?? {};
  if (r.enabled === false) return false;
  const value = String(r.value ?? "").trim();
  if (!value) return false; // порожнє значення — правило неактивне
  const t = String(text ?? "").trim();
  const op = (r.op || "contains") as "contains" | "equals";
  if (op === "equals") return t.toLowerCase() === value.toLowerCase();
  return t.toLowerCase().includes(value.toLowerCase());
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
    // перевіряємо з «кінця» (новіші зазвичай наприкінці)
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

  // 4) Mode: dry-run vs apply
  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "1";

  // Optional explicit pair (debug)
  const qpPipeline = url.searchParams.get("pipeline_id");
  const qpStatus = url.searchParams.get("status_id");

  // 5) Load active campaigns (or build pseudo-campaign from query)
  let campaigns: Campaign[] = [];
  if (qpPipeline && qpStatus) {
    campaigns = [
      {
        id: "debug",
        base_pipeline_id: String(qpPipeline),
        base_status_id: String(qpStatus),
        to_pipeline_id: null,
        to_status_id: null,
        rules: { v1: { enabled: true, field: "text", op: "contains", value: "" } },
      },
    ];
  } else {
    campaigns = await listActiveCampaignsDetailed();
  }
  if (!campaigns.length) {
    return NextResponse.json(
      { ok: false, error: "No campaigns to search (provide ?pipeline_id&status_id or configure active campaigns)" },
      { status: 400 }
    );
  }

  // 6) Try to find & (optionally) move — first hit wins
  for (const c of campaigns) {
    const { source, card } = await localFindInPair({
      pipeline_id: c.base_pipeline_id,
      status_id: c.base_status_id,
      username,
      fullname,
    });
    if (!card) continue;

    const v1ok = matchV1(text, c.rules?.v1);
    const target = {
      pipeline_id: c.to_pipeline_id ?? undefined,
      status_id: c.to_status_id ?? undefined,
    };
    const would_move = Boolean(v1ok && (target.pipeline_id || target.status_id));

    if (apply && would_move) {
      const res = await kcMoveCard(
        Number(card.id),
        target.pipeline_id ? Number(target.pipeline_id) : undefined,
        target.status_id ? Number(target.status_id) : undefined
      );
      return NextResponse.json({
        ok: true,
        mode: "apply",
        campaign: { id: c.id, name: c.name, base: { pipeline_id: c.base_pipeline_id, status_id: c.base_status_id }, target },
        match: { source, card },
        rule_v1: { ok: v1ok, ...c.rules?.v1 },
        move: res,
        input: { username, fullname, text },
      });
    } else {
      return NextResponse.json({
        ok: true,
        mode: "dry-run",
        campaign: { id: c.id, name: c.name, base: { pipeline_id: c.base_pipeline_id, status_id: c.base_status_id }, target },
        match: { source, card },
        rule_v1: { ok: v1ok, ...c.rules?.v1 },
        would_move,
        input: { username, fullname, text },
      });
    }
  }

  // 7) Not found in any campaign
  return NextResponse.json({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    match: null,
    input: { username, fullname, text },
  });
}
