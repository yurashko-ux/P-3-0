// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";

// 🔥 прибираємо будь-яке кешування цього маршруту
export const dynamic = "force-dynamic";
export const revalidate = 0;

type VariantOp = "contains" | "equals";
type VariantRule = { field: "text"; op: VariantOp; value: string };
export type Campaign = {
  id: string; // зберігаємо як string для узгодженості з KV
  name: string;
  active?: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  rules: { v1: VariantRule; v2?: VariantRule };
  exp_days?: number;
  exp_to_pipeline_id?: number;
  exp_to_status_id?: number;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
  created_at?: number;
  updated_at?: number;
};

function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function reqNumber(n: unknown, def?: number): number {
  const x = Number(n);
  if (Number.isFinite(x)) return x;
  if (def !== undefined) return def;
  throw new Error("Expected number");
}

function normalizeRule(r?: any): VariantRule | undefined {
  if (!r) return undefined;
  const value = String(r.value ?? "").trim();
  const op = (r.op === "equals" ? "equals" : "contains") as VariantOp;
  return { field: "text", op, value };
}

function validateIncoming(body: any): { payload: Omit<Campaign, "id"> } {
  const name = String(body?.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const base_pipeline_id = reqNumber(body?.base_pipeline_id);
  const base_status_id = reqNumber(body?.base_status_id);

  const v1 = normalizeRule(body?.rules?.v1);
  const v2 = normalizeRule(body?.rules?.v2);
  if (!v1 || v1.value.length === 0) {
    throw new Error("rules.v1.value is required (non-empty)");
  }

  const exp_days = body?.exp_days != null ? reqNumber(body.exp_days) : undefined;
  const exp_to_pipeline_id =
    body?.exp_to_pipeline_id != null ? reqNumber(body.exp_to_pipeline_id) : undefined;
  const exp_to_status_id =
    body?.exp_to_status_id != null ? reqNumber(body.exp_to_status_id) : undefined;

  const payload: Omit<Campaign, "id"> = {
    name,
    active: body?.active !== false, // за замовчуванням true
    base_pipeline_id,
    base_status_id,
    rules: { v1, ...(v2 && v2.value ? { v2 } : {}) },
    exp_days,
    exp_to_pipeline_id,
    exp_to_status_id,
    v1_count: body?.v1_count ?? 0,
    v2_count: body?.v2_count ?? 0,
    exp_count: body?.exp_count ?? 0,
  };
  return { payload };
}

// GET /api/campaigns — список (за індексом)
export async function GET(req: Request) {
  try {
    await assertAdmin(req);
  } catch {
    return bad(401, "unauthorized");
  }

  // читаємо індекс у зворотному порядку (нові зверху)
  const ids: string[] = await kvZRevRange("campaigns:index", 0, -1);
  const out: Campaign[] = [];

  for (const id of ids || []) {
    const c = await kvGet(`campaigns:${id}`);
    if (c) out.push(c as Campaign);
  }

  return NextResponse.json({ ok: true, data: out }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

// POST /api/campaigns — створення
export async function POST(req: Request) {
  try {
    await assertAdmin(req);
  } catch {
    return bad(401, "unauthorized");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "invalid json");
  }

  try {
    const { payload } = validateIncoming(body);
    const now = Date.now();
    const id = String(body?.id ?? now); // генеруємо id, якщо не передали

    const created: Campaign = {
      id,
      ...payload,
      created_at: body?.created_at ?? now,
      updated_at: now,
    };

    // 1) сам обʼєкт
    await kvSet(`campaigns:${id}`, created);
    // 2) індекс
    await kvZAdd("campaigns:index", now, id);

    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (e: any) {
    const msg = String(e?.message ?? "validation error");
    if (msg.includes("rules.v1.value")) {
      return bad(400, "rules.v1.value is required (non-empty)");
    }
    return bad(400, msg);
  }
}
