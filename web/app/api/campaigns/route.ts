// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";
import { assertAdmin } from "@/lib/auth";

/** ===== Types ===== */
type VariantOp = "contains" | "equals";

type Rule = {
  field: "text";
  op: VariantOp;
  value: string; // збережемо як рядок
};

export type Campaign = {
  id: string;
  name: string;

  base_pipeline_id: number;
  base_status_id: number;

  rule_v1: Rule;         // обов'язкове
  rule_v2?: Rule | null; // опційне

  exp_days?: number | null;
  exp_to_pipeline_id?: number | null;
  exp_to_status_id?: number | null;

  // лічильники
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;

  // службове
  created_at: number;
  updated_at: number;
  deleted?: boolean;
};

/** ===== Helpers ===== */
function bad(status: number, message: string) {
  return new NextResponse(message, { status });
}
function okJSON(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isOp(x: unknown): x is VariantOp {
  return x === "contains" || x === "equals";
}

/** Нормалізація Rule — приводимо value до рядка */
function normalizeRule(input: any): Rule | null {
  const op = input?.op;
  const value = str(input?.value);
  if (!isOp(op)) return null;
  if (!value) return null;
  return { field: "text", op, value };
}

/** ===== GET /api/campaigns =====
 * Повертає список кампаній (нові зверху)
 */
export async function GET(req: Request) {
  await assertAdmin(req);

  // забираємо всі id і вже в коді реверсимо (щоб не залежати від kvZRevRange)
  const ids = (await kvZRange("campaigns:index", 0, -1)) ?? [];
  const out: Campaign[] = [];
  for (const id of [...ids].reverse()) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    try {
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!c?.deleted) out.push(c as Campaign);
    } catch {
      // ігноруємо биті записи
    }
  }
  return okJSON({ items: out });
}

/** ===== POST /api/campaigns =====
 * Створення кампанії
 */
export async function POST(req: Request) {
  await assertAdmin(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  // базові поля
  const name = str(body?.name);
  const base_pipeline_id = num(body?.base_pipeline_id);
  const base_status_id = num(body?.base_status_id);

  // правила
  // приводимо до рядка — навіть якщо користувач ввів число "1", збережемо "1"
  const ruleV1 = normalizeRule({
    op: body?.rules?.v1?.op ?? body?.rule_v1?.op,
    value: str(body?.rules?.v1?.value ?? body?.rule_v1?.value),
  });
  const ruleV2raw = normalizeRule({
    op: body?.rules?.v2?.op ?? body?.rule_v2?.op,
    value: str(body?.rules?.v2?.value ?? body?.rule_v2?.value),
  });
  const rule_v2 = ruleV2raw ?? null;

  // expire
  const exp_days = num(body?.expire?.days ?? body?.exp_days);
  const exp_to_pipeline_id = num(
    body?.expire?.to_pipeline_id ?? body?.exp_to_pipeline_id
  );
  const exp_to_status_id = num(
    body?.expire?.to_status_id ?? body?.exp_to_status_id
  );

  // валідація
  if (!name) return bad(400, "name is required");
  if (!base_pipeline_id || !base_status_id)
    return bad(400, "base_pipeline_id & base_status_id are required");

  if (!ruleV1) {
    // повідомлення під ваш UI
    return bad(400, "rules.v1.value is required (non-empty)");
  }

  // формуємо кампанію
  const now = Date.now();
  const id = String(now);

  const campaign: Campaign = {
    id,
    name,
    base_pipeline_id,
    base_status_id,
    rule_v1: ruleV1,
    rule_v2,

    exp_days: exp_days ?? null,
    exp_to_pipeline_id: exp_to_pipeline_id ?? null,
    exp_to_status_id: exp_to_status_id ?? null,

    v1_count: 0,
    v2_count: 0,
    exp_count: 0,

    created_at: now,
    updated_at: now,
  };

  // зберігаємо
  await kvSet(`campaigns:${id}`, campaign);
  await kvZAdd("campaigns:index", now, id);

  return okJSON({ ok: true, id, campaign }, 201);
}
