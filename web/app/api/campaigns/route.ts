// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

// ---- types (локально, щоб не ламались імпорти) ----
type VariantOp = "contains" | "equals";
type VariantRule = { field: "text"; op: VariantOp; value: string };
type Campaign = {
  id: string;
  name: string;
  created_at: number;

  base_pipeline_id: number;
  base_status_id: number;

  rules: {
    v1: VariantRule;
    v2?: VariantRule;
  };

  exp_days: number;
  exp_to_pipeline_id: number;
  exp_to_status_id: number;

  counters?: { v1_count?: number; v2_count?: number; exp_count?: number };
  active?: boolean;
};

// ---- helpers ----
function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function safeParse<T = any>(raw: unknown): T | null {
  if (raw == null) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return null;
  }
}

function trimOrEmpty(x: unknown): string {
  return String(x ?? "").trim();
}

/** Приймає або рядок, або об'єкт і повертає нормалізоване правило, або undefined */
function coerceRule(input: any): VariantRule | undefined {
  if (!input) return undefined;

  // якщо прийшов просто рядок
  if (typeof input === "string") {
    const value = trimOrEmpty(input);
    if (!value) return undefined;
    return { field: "text", op: "contains", value };
  }

  // якщо прийшов об'єкт
  if (typeof input === "object") {
    const value = trimOrEmpty(input.value);
    if (!value) return undefined;
    const op: VariantOp =
      input.op === "equals" || input.op === "contains" ? input.op : "contains";
    return { field: "text", op, value };
  }

  return undefined;
}

// ---------- GET: список кампаній ----------
export async function GET(req: Request) {
  await assertAdmin(req);

  let ids: string[] = [];
  try {
    ids = (await kvZRange("campaigns:index", 0, -1)) || [];
  } catch {
    ids = [];
  }

  const out: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = safeParse<Campaign>(raw);
    if (c) out.push(c);
  }

  return NextResponse.json({ ok: true, data: out });
}

// ---------- POST: створення кампанії ----------
export async function POST(req: Request) {
  await assertAdmin(req);

  const body = await req.json().catch(() => null);
  if (!body) return bad(400, "invalid JSON body");

  // базові поля
  const name = trimOrEmpty(body.name || body.title);
  const base_pipeline_id = Number(body.base_pipeline_id ?? body.pipeline_id);
  const base_status_id = Number(body.base_status_id ?? body.status_id);

  // правила: приймаємо і "рядок", і "об'єкт"
  const ruleV1 = coerceRule(body.rules?.v1 ?? body.v1 ?? body.rules_v1);
  const ruleV2 = coerceRule(body.rules?.v2 ?? body.v2 ?? body.rules_v2);

  if (!ruleV1) return bad(400, "rules.v1.value is required (non-empty)");

  // expire
  const exp_days = Number(body.exp_days ?? body.exp?.days ?? 0) || 0;
  const exp_to_pipeline_id = Number(
    body.exp_to_pipeline_id ?? body.exp?.pipeline_id ?? base_pipeline_id
  );
  const exp_to_status_id = Number(
    body.exp_to_status_id ?? body.exp?.status_id ?? base_status_id
  );

  // валідації
  if (!name) return bad(400, "name is required");
  if (!base_pipeline_id || !base_status_id)
    return bad(400, "base_pipeline_id and base_status_id are required");

  // формуємо повний об'єкт кампанії
  const id = String(Date.now());
  const created: Campaign = {
    id,
    name,
    created_at: Date.now(),
    base_pipeline_id,
    base_status_id,
    rules: { v1: ruleV1, ...(ruleV2 ? { v2: ruleV2 } : {}) },
    exp_days,
    exp_to_pipeline_id,
    exp_to_status_id,
    counters: { v1_count: 0, v2_count: 0, exp_count: 0 },
    active: true,
  };

  // збереження (KV очікує string → зберігаємо JSON)
  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", Date.now(), id);

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
