// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

type VariantOp = "contains" | "equals";
type TextRule = { op: VariantOp; value: string }; // field = 'text' за замовчуванням
type ExpRule = { days: number; to_pipeline_id: number; to_status_id: number };

export type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active: boolean;

  base_pipeline_id: number;
  base_status_id: number;

  v1: TextRule;
  v2?: TextRule; // опційно

  exp?: ExpRule;

  // лічильники (для UI)
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

/* ----------------------------- helpers ---------------------------------- */

function asNumber(x: any, def = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function normalizeTextRule(x: any | undefined | null): TextRule | undefined {
  if (!x) return undefined;
  const op = (x.op ?? x?.rule?.op ?? "").toString().toLowerCase() as VariantOp;
  const value = (x.value ?? x?.rule?.value ?? "").toString();
  if (!value) return undefined;
  if (op !== "contains" && op !== "equals") return undefined;
  return { op, value };
}

function normalizeExpRule(x: any | undefined | null): ExpRule | undefined {
  if (!x) return undefined;
  const days = asNumber(x.days ?? x.exp_days, 0);
  const to_pipeline_id = asNumber(x.to_pipeline_id ?? x.exp_to_pipeline_id, 0);
  const to_status_id = asNumber(x.to_status_id ?? x.exp_to_status_id, 0);
  if (!days || !to_pipeline_id || !to_status_id) return undefined;
  return { days, to_pipeline_id, to_status_id };
}

function parseMaybeJson<T = unknown>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as T;
  return undefined;
}

/* -------------------------------- GET ----------------------------------- */

export async function GET(req: Request) {
  await assertAdmin(req);

  // Нові зверху (rev-range)
  const ids = await kvZRevRange("campaigns:index", 0, -1).catch(
    () => [] as string[]
  );

  const items: Campaign[] = [];

  for (const id of ids ?? []) {
    const raw = await kvGet<unknown>(`campaigns:${id}`);
    const obj = parseMaybeJson<any>(raw);
    if (!obj) continue;

    // Підтримка старих форм та актуалізація типів
    const v1 =
      normalizeTextRule(obj.v1 ?? obj.rules?.v1) ??
      undefined; // v1 обов'язкове при створенні, але не ламаємо рендер

    const v2 = normalizeTextRule(obj.v2 ?? obj.rules?.v2) ?? undefined;
    const exp = normalizeExpRule(obj.exp) ?? undefined;

    const c: Campaign = {
      id: String(obj.id ?? id),
      name: String(obj.name ?? ""),
      created_at: asNumber(obj.created_at, Date.now()),
      active: !!obj.active,

      base_pipeline_id: asNumber(obj.base_pipeline_id),
      base_status_id: asNumber(obj.base_status_id),

      v1: v1 ?? { op: "contains", value: "" }, // щоб UI не падав
      v2,
      exp,

      v1_count: asNumber(obj.v1_count, 0),
      v2_count: asNumber(obj.v2_count, 0),
      exp_count: asNumber(obj.exp_count, 0),
    };

    items.push(c);
  }

  return NextResponse.json({ ok: true, count: items.length, items });
}

/* -------------------------------- POST ---------------------------------- */
/**
 * Очікуваний body (допускаємо обидві форми):
 * {
 *   name: string,
 *   base_pipeline_id: number,
 *   base_status_id: number,
 *   v1: { op: "contains"|"equals", value: string },
 *   v2?: { op: "contains"|"equals", value: string },
 *   exp?: { days:number, to_pipeline_id:number, to_status_id:number }
 * }
 * або
 * {
 *   name,
 *   base_pipeline_id, base_status_id,
 *   rules: { v1:{...}, v2?:{...} },
 *   exp: {...}
 * }
 */
export async function POST(req: Request) {
  await assertAdmin(req);

  const bad = (status: number, message: string) =>
    NextResponse.json({ ok: false, error: message }, { status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  const name = String(body?.name ?? "").trim();
  const base_pipeline_id = asNumber(body?.base_pipeline_id);
  const base_status_id = asNumber(body?.base_status_id);

  // Правила можуть прийти як root.v1/root.v2 або root.rules.v1/root.rules.v2
  const v1 = normalizeTextRule(body?.v1 ?? body?.rules?.v1);
  const v2 = normalizeTextRule(body?.v2 ?? body?.rules?.v2);
  const exp = normalizeExpRule(body?.exp);

  if (!name) return bad(400, "name is required");
  if (!base_pipeline_id || !base_status_id)
    return bad(400, "base_pipeline_id and base_status_id are required");

  if (!v1 || !v1.value) {
    return bad(400, "rules.v1.value is required (non-empty)");
  }

  // Створюємо id на основі epoch (просто і достатньо унікально для цього сервісу)
  const created_at = Date.now();
  const id = String(created_at);

  const campaign: Campaign = {
    id,
    name,
    created_at,
    active: false,
    base_pipeline_id,
    base_status_id,
    v1,
    v2,
    exp,
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // Зберігаємо як JSON-рядок (щоб kvGet завжди повертав string → менше неоднозначності)
  await kvSet(`campaigns:${id}`, JSON.stringify(campaign));
  await kvZAdd("campaigns:index", created_at, id);

  return NextResponse.json({ ok: true, id, campaign }, { status: 201 });
}
