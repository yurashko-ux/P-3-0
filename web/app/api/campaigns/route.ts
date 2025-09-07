// web/app/api/campaigns/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// ---- Upstash KV helpers (REST) ----
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const H: HeadersInit = KV_TOKEN ? { Authorization: `Bearer ${KV_TOKEN}` } : {};

async function kvGet(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H, cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null as any);
  return (j && typeof j.result === "string") ? j.result : null;
}
async function kvSet(key: string, value: any) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ value: JSON.stringify(value) }),
  });
}
async function kvZadd(key: string, score: number, member: string) {
  if (!KV_URL || !KV_TOKEN) throw new Error("KV not configured");
  await fetch(`${KV_URL}/zadd/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify([{ score, member }]),
  });
}
async function kvZrange(key: string, start = 0, stop = -1): Promise<string[]> {
  if (!KV_URL || !KV_TOKEN) return [];
  const r = await fetch(`${KV_URL}/zrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    headers: H,
    cache: "no-store",
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null as any);
  return Array.isArray(j?.result) ? j.result.map(String) : [];
}

// ---- helpers ----
type Cond = { field: "text" | "flow" | "tag" | "any"; op: "contains" | "equals"; value: string } | null;
function asCond(payload: any, prefix: "v1" | "v2"): Cond {
  const c = payload?.[`${prefix}_condition`];
  if (c && c.field && c.op) {
    return { field: String(c.field), op: String(c.op) as any, value: String(c.value ?? "") } as any;
  }
  const field = payload?.[`${prefix}_field`];
  const op = payload?.[`${prefix}_op`];
  const value = payload?.[`${prefix}_value`];
  const enabled = prefix === "v2" ? !!(payload?.v2_enabled || value) : true;
  if (!enabled) return null;
  return { field: (field ?? "any") as any, op: (op ?? "contains") as any, value: String(value ?? "") };
}
function strOrNull(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}
function numOr(v: any, d = 0): number {
  const n = Number(v); return Number.isFinite(n) ? n : d;
}
function newId(): string {
  // @ts-ignore
  return (globalThis.crypto?.randomUUID?.() as string) || `c_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

// ---- GET list ----
export async function GET() {
  try {
    const ids = await kvZrange("campaigns:index", 0, -1);
    const items: any[] = [];
    for (const id of ids.reverse()) {
      const raw = await kvGet(`campaigns:${id}`);
      if (!raw) continue;
      try { items.push(JSON.parse(raw)); } catch {}
    }
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "kv error" }, { status: 500 });
  }
}

// ---- POST create ----
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = newId();
    const created_at = new Date().toISOString();

    const item = {
      id,
      created_at,
      name: String(body?.name ?? ""),
      base_pipeline_id: String(body?.base_pipeline_id ?? ""),
      base_status_id: String(body?.base_status_id ?? ""),
      v1_condition: asCond(body, "v1"),
      v1_to_pipeline_id: strOrNull(body?.v1_to_pipeline_id),
      v1_to_status_id: strOrNull(body?.v1_to_status_id),
      v2_condition: asCond(body, "v2"),
      v2_to_pipeline_id: strOrNull(body?.v2_to_pipeline_id),
      v2_to_status_id: strOrNull(body?.v2_to_status_id),
      exp_days: numOr(body?.exp_days, 0),
      exp_to_pipeline_id: strOrNull(body?.exp_to_pipeline_id),
      exp_to_status_id: strOrNull(body?.exp_to_status_id),
      note: body?.note ? String(body.note) : null,
      enabled: body?.enabled !== false,
      v1_count: 0, v2_count: 0, exp_count: 0,
    };

    if (!item.name || !item.base_pipeline_id || !item.base_status_id) {
      return NextResponse.json({ ok: false, error: "missing required fields" }, { status: 400 });
    }

    await kvSet(`campaigns:${id}`, item);
    await kvZadd("campaigns:index", Date.now(), id);

    return NextResponse.json({ ok: true, id, item }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "save failed" }, { status: 500 });
  }
}
