// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvDel, kvZAdd, kvZRem, kvZRange, kvZRevRange } from "@/lib/kv";

type VariantOp = "contains" | "equals";
type VariantRule = { field: "text"; op: VariantOp; value: string };
type Campaign = {
  id: string;
  name: string;

  // базова пара (обов’язково)
  base_pipeline_id: number;
  base_status_id: number;

  // правила
  v1: VariantRule;
  v2?: VariantRule | null;

  // expire (опційно)
  exp_days?: number | null;
  exp_to_pipeline_id?: number | null;
  exp_to_status_id?: number | null;

  // системні поля
  active?: boolean;
  created_at?: string;        // ISO
  created_epoch?: number;     // ms
  updated_at?: string;        // ISO
  updated_epoch?: number;     // ms

  // лічильники
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

const IDX = "campaigns:index";
const KEY = (id: string) => `campaigns:${id}`;

// ───────────────────────────────────────────────────────────────────────────────
// helpers
function nowIso() { return new Date().toISOString(); }
function toEpoch(d: string | number | Date | undefined) {
  const ms = d ? Date.parse(String(d)) : NaN;
  return Number.isFinite(ms) ? ms : Date.now();
}
function safeNum(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}
function ensureRule(r?: any): VariantRule | null {
  if (!r) return null;
  const value = String(r.value ?? "").trim();
  if (!value) return null;
  const op = (r.op === "equals" ? "equals" : "contains") as VariantOp;
  return { field: "text", op, value };
}
function decorate(c: Campaign) {
  // fallback-и для старих записів
  const created_epoch = c.created_epoch ?? toEpoch(c.created_at);
  const updated_epoch = c.updated_epoch ?? created_epoch;
  const created_at = c.created_at ?? new Date(created_epoch).toISOString();
  const updated_at = c.updated_at ?? new Date(updated_epoch).toISOString();

  // для відображення в UI
  const exp_days_label =
    typeof c.exp_days === "number" && Number.isFinite(c.exp_days)
      ? `${c.exp_days} днів`
      : "—";

  return { ...c, created_at, created_epoch, updated_at, updated_epoch, exp_days_label };
}
// ───────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/campaigns
 * Повертає список кампаній від нових до старих з гарантовано валідною датою/лейблом.
 */
export async function GET() {
  // читаємо індекс у зворотньому порядку (нові зверху); якщо немає kvZRevRange – використай kvZRange і розверни масив
  const ids: string[] =
    (await (kvZRevRange?.(IDX, 0, -1) ?? kvZRange(IDX, 0, -1))) || [];

  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(KEY(id));
    if (!raw) continue;
    // захист від битих JSON-ів
    let c: Campaign;
    try { c = typeof raw === "string" ? JSON.parse(raw) : raw; }
    catch { continue; }
    items.push(decorate(c));
  }
  return NextResponse.json({ items });
}

/**
 * POST /api/campaigns
 * Створює нову кампанію; забезпечує created_at/epoch та правильне сортування в індексі.
 */
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  // валідація мінімуму
  const name = String(body.name ?? "").trim();
  const base_pipeline_id = Number(body.base_pipeline_id);
  const base_status_id = Number(body.base_status_id);
  const v1 = ensureRule(body.v1);
  const v2 = ensureRule(body.v2);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Number.isFinite(base_pipeline_id) || !Number.isFinite(base_status_id)) {
    return NextResponse.json({ error: "base pair is required" }, { status: 400 });
  }
  if (!v1) return NextResponse.json({ error: "rules.v1.value is required (non-empty)" }, { status: 400 });

  const id = crypto.randomUUID();

  const created_epoch = Date.now();
  const created_at = new Date(created_epoch).toISOString();

  const exp_days = safeNum(body.exp_days);
  const exp_to_pipeline_id = safeNum(body.exp_to_pipeline_id);
  const exp_to_status_id = safeNum(body.exp_to_status_id);

  const c: Campaign = {
    id,
    name,
    base_pipeline_id,
    base_status_id,
    v1,
    v2: v2 ?? null,
    exp_days,
    exp_to_pipeline_id,
    exp_to_status_id,
    active: true,
    created_at,
    created_epoch,
    updated_at: created_at,
    updated_epoch: created_epoch,
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // запис і індексація: score = created_epoch → нові зверху
  await kvSet(KEY(id), c);
  await kvZAdd(IDX, created_epoch, id);

  return NextResponse.json({ ok: true, id, item: decorate(c) });
}

/**
 * DELETE /api/campaigns?id=...
 * (опційно) — швидке видалення з індексу та KV.
 */
export async function DELETE(req: Request) {
  await assertAdmin(req);
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await kvDel(KEY(id));
  await kvZRem(IDX, id);
  return NextResponse.json({ ok: true, id });
}
