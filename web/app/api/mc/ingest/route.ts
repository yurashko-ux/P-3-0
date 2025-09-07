// web/app/api/mc/ingest/route.ts
// ManyChat → Campaigns matcher → KeyCRM move
// Повна заміна: виправляє типи ('v1' | 'v2' | 'exp') і правильний шлях до lib/kv.

import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZrevrange } from "../../../../lib/kv"; // <-- виправлено

export const revalidate = 0;
export const dynamic = "force-dynamic";

// ---- Types ----
type Condition =
  | { field: "text" | "flow" | "tag" | "any"; op: "contains" | "equals"; value: string }
  | null;

type Campaign = {
  id: string;
  created_at: string;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  v1_condition: Condition;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;
  v2_condition: Condition;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;
  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;
  note?: string | null;
  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
};

type Variant = "v1" | "v2" | "exp";

// ---- Helpers ----
function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data } as any, { status });
}
function err(message: string, status = 400, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error: message, ...extra } as any, { status });
}

function auth(req: Request): boolean {
  const header = req.headers.get("authorization");
  const url = new URL(req.url);
  const token =
    (header && header.startsWith("Bearer ") ? header.slice(7) : "") ||
    url.searchParams.get("token") ||
    "";
  return !!token && token === process.env.MC_TOKEN;
}

function normalizeUsername(u: string) {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._]/g, "");
}

function matchCondition(cond: Condition, payload: any): boolean {
  if (!cond) return false;
  if (cond.field === "any") return true;

  const v = String(cond.value ?? "").toLowerCase();

  switch (cond.field) {
    case "text": {
      const src = String(payload.text ?? payload.message ?? "").toLowerCase();
      return cond.op === "equals" ? src === v : src.includes(v);
    }
    case "flow": {
      const src = String(payload.flow ?? "").toLowerCase();
      return cond.op === "equals" ? src === v : src.includes(v);
    }
    case "tag": {
      const tags: string[] = Array.isArray(payload.tags) ? payload.tags : [];
      const low = tags.map((t) => String(t).toLowerCase());
      return cond.op === "equals" ? low.includes(v) : low.some((t) => t.includes(v));
    }
    default:
      return false;
  }
}

async function getAllCampaigns(): Promise<Campaign[]> {
  const ids = await kvZrevrange("campaigns:index", 0, 999);
  const res: Campaign[] = [];
  for (const id of ids) {
    const item = await kvGet<Campaign>(`campaigns:${id}`);
    if (item) res.push(item);
  }
  return res;
}

async function resolveCardIdByUsername(req: Request, username: string): Promise<string | null> {
  const key = `ig:map:${username}`;
  const cached = await kvGet<string>(key);
  if (cached) return cached;

  const url = new URL("/api/keycrm/card/by-username", req.url);
  url.searchParams.set("u", username);
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  if (j?.ok && j?.card_id) {
    await kvSet(key, j.card_id);
    return j.card_id as string;
  }
  return null;
}

async function moveCardViaProxy(req: Request, card_id: string, to_pipeline_id: string, to_status_id: string) {
  const url = new URL("/api/keycrm/card/move", req.url);
  const r = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ card_id, to_pipeline_id, to_status_id }),
  });
  if (!r.ok) throw new Error(`keycrm move failed: ${r.status}`);
}

// ---- Handler ----
export async function POST(req: Request) {
  try {
    if (!auth(req)) return err("unauthorized", 401);

    const body = (await req.json().catch(() => ({}))) as any;
    const username =
      body.username ||
      body.ig_username ||
      body.user?.username ||
      body.sender?.username ||
      body.user?.name;

    if (!username) return err("missing username", 400);

    const ig = normalizeUsername(username);
    const card_id = await resolveCardIdByUsername(req, ig);
    if (!card_id) return err("card not found for username", 404, { username: ig });

    const campaigns = (await getAllCampaigns()).filter((c) => c.enabled);

    const actions: Array<{
      campaign_id: string;
      variant: Variant;
      moved_to: { pipeline_id: string; status_id: string };
    }> = [];

    for (const c of campaigns) {
      let selected: Variant | null = null;
      if (matchCondition(c.v1_condition, body)) selected = "v1";
      else if (matchCondition(c.v2_condition, body)) selected = "v2";
      if (!selected) continue;

      let to_pipeline = c.exp_to_pipeline_id;
      let to_status = c.exp_to_status_id;
      if (selected === "v1") {
        to_pipeline = c.v1_to_pipeline_id;
        to_status = c.v1_to_status_id;
      } else if (selected === "v2") {
        to_pipeline = c.v2_to_pipeline_id;
        to_status = c.v2_to_status_id;
      }
      if (!to_pipeline || !to_status) continue;

      await moveCardViaProxy(req, String(card_id), String(to_pipeline), String(to_status));

      const fresh = await kvGet<Campaign>(`campaigns:${c.id}`);
      if (fresh) {
        if (selected === "v1") fresh.v1_count++;
        else if (selected === "v2") fresh.v2_count++;
        await kvSet(`campaigns:${c.id}`, fresh);
      }

      actions.push({
        campaign_id: c.id,
        variant: selected,
        moved_to: { pipeline_id: String(to_pipeline), status_id: String(to_status) },
      });
    }

    return ok({ actions });
  } catch (e: any) {
    return err(e?.message ?? "ingest failed", 500);
  }
}
