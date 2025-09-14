// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

// ---- local types ----
type VariantOp = "contains" | "equals";
type VariantRule = { field: "text"; op: VariantOp; value: string };
type Campaign = {
  id: string;
  name: string;
  created_at: number;

  base_pipeline_id: number;
  base_status_id: number;

  rules: { v1: VariantRule; v2?: VariantRule };

  exp_days: number;
  exp_to_pipeline_id: number;
  exp_to_status_id: number;

  counters?: { v1_count?: number; v2_count?: number; exp_count?: number };
  active?: boolean;
};

// ---- helpers ----
const bad = (status: number, message: string, extra?: any) =>
  NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status });

const trimOrEmpty = (x: unknown) => String(x ?? "").trim();

function coerceRule(input: any): VariantRule | undefined {
  if (!input) return undefined;

  // plain string/number
  if (typeof input === "string" || typeof input === "number") {
    const value = trimOrEmpty(input);
    if (!value) return undefined;
    return { field: "text", op: "contains", value };
  }

  // object { value, op? }
  if (typeof input === "object") {
    // іноді прилітає { value } або { v: ... } або { text: ... }
    const rawValue =
      input.value ?? input.v ?? input.text ?? input.val ?? input.keyword ?? input.query;
    const value = trimOrEmpty(rawValue);
    if (!value) return undefined;

    const rawOp = String(input.op ?? input.operator ?? "").toLowerCase();
    const op: VariantOp = rawOp === "equals" ? "equals" : "contains";

    return { field: "text", op, value };
  }

  return undefined;
}

/** Витягує можливі варіанти з різних назв полів форми */
function pickPossibleV(body: any, which: 1 | 2) {
  const idx = which === 1 ? "1" : "2";
  const candidates: any[] = [
    // сучасна схема
    body?.rules?.[`v${idx}`],
    // «плоскі» варіанти
    body?.[`v${idx}`],
    body?.[`rules_v${idx}`],
    body?.[`v${idx}_value`],
    body?.[`value${idx}`],
    body?.[`variant${idx}_value`],
    body?.[`variant_${idx}`]?.value,
    body?.[`rule${idx}`],
    body?.[`rule${idx}_value`],
    body?.[`ruleV${idx}`],
    body?.[`ruleV${idx}_value`],
    // дуже обережний запасний варіант (інколи фронт шле {opX,valueX})
    body?.[`op${idx}`] || body?.[`operator${idx}`]
      ? { op: body?.[`op${idx}`] || body?.[`operator${idx}`], value: body?.[`value${idx}`] }
      : undefined,
  ].filter((x) => x !== undefined);

  return candidates.find((x) => coerceRule(x)) ?? candidates[0];
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
    const c = (() => {
      try {
        return typeof raw === "string" ? (JSON.parse(raw) as Campaign) : (raw as Campaign);
      } catch {
        return null;
      }
    })();
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

  // v1/v2 з максимальною толерантністю до назв
  const v1Raw = pickPossibleV(body, 1);
  const v2Raw = pickPossibleV(body, 2);
  const ruleV1 = coerceRule(v1Raw);
  const ruleV2 = coerceRule(v2Raw);

  if (!ruleV1) {
    return bad(400, "rules.v1.value is required (non-empty)", {
      receivedKeys: Object.keys(body || {}),
      sample: { expected: { rules: { v1: { value: "text", op: "contains|equals" } } } },
    });
  }

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

  // формуємо об'єкт
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

  // збереження — рядком
  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", Date.now(), id);

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
