// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

// ───────────────────────────────────────────────────────────────────────────────
// Типи
type RuleOp = "contains" | "equals";
type Rule = {
  field: "text";
  op: RuleOp;
  value: string;
  pipeline_id?: number | null;
  status_id?: number | null;
};

type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  v1: { pipeline_id: number | null; status_id: number | null; value: string; op?: RuleOp };
  v2: { pipeline_id: number | null; status_id: number | null; value: string; op?: RuleOp };
  exp: { days: number; to_pipeline_id: number; to_status_id: number };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ───────────────────────────────────────────────────────────────────────────────
// Хелпери
function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeRuleInput(input: any): Rule {
  if (typeof input === "string") {
    return { field: "text", op: "contains", value: input.trim() };
  }
  if (input && typeof input === "object") {
    const op: RuleOp = input.op === "equals" ? "equals" : "contains";
    const value = String(input.value ?? "").trim();
    return {
      field: "text",
      op,
      value,
      pipeline_id: numOrNull(input.pipeline_id),
      status_id: numOrNull(input.status_id),
    };
  }
  // за замовчуванням — порожнє правило (не зламає створення)
  return { field: "text", op: "contains", value: "" };
}

function safeParse<T>(raw: any): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

// ───────────────────────────────────────────────────────────────────────────────
// GET /api/campaigns — список кампаній (без зовнішніх залежностей)
export async function GET(req: Request) {
  await assertAdmin(req);

  // Останні N ідентифікаторів із індексу (новіші наприкінці)
  const ids: string[] =
    (await kvZRange("campaigns:index", -1000, -1).catch(() => [] as any)) ?? [];

  const items: Campaign[] = [];
  for (const id of ids ?? []) {
    const raw = await kvGet(`campaigns:${id}`).catch(() => null as any);
    const c = safeParse<Campaign>(raw);
    if (c) items.push(c);
  }

  // Виводимо як є; фронт уже знає, як показати v1/v2/base/exp
  return NextResponse.json({ ok: true, count: items.length, items });
}

// ───────────────────────────────────────────────────────────────────────────────
// POST /api/campaigns — створення кампанії (послаблена валідація v1/v2)
export async function POST(req: Request) {
  await assertAdmin(req);

  const body: any = (await req.json().catch(() => ({}))) ?? {};

  const id = String(Date.now());
  const created_at = Date.now();

  const base_pipeline_id =
    Number(body.base_pipeline_id ?? body.base?.pipeline_id ?? 0) || 0;
  const base_status_id =
    Number(body.base_status_id ?? body.base?.status_id ?? 0) || 0;

  // Лояльна нормалізація правил:
  const v1 = normalizeRuleInput(body.rules?.v1);
  const v2 = normalizeRuleInput(body.rules?.v2);

  const expDays = Number(body.exp?.days ?? body.exp_days ?? 7) || 7;
  const exp_to_pipeline_id =
    Number(body.exp?.to_pipeline_id ?? body.to_pipeline_id ?? 0) || 0;
  const exp_to_status_id =
    Number(body.exp?.to_status_id ?? body.to_status_id ?? 0) || 0;

  const item: Campaign = {
    id,
    name: String(body.name ?? "").trim() || "Без назви",
    created_at,
    active: !!body.active,
    base_pipeline_id,
    base_status_id,
    v1: {
      pipeline_id: numOrNull(v1.pipeline_id),
      status_id: numOrNull(v1.status_id),
      value: v1.value ?? "",
      op: v1.op ?? "contains",
    },
    v2: {
      pipeline_id: numOrNull(v2.pipeline_id),
      status_id: numOrNull(v2.status_id),
      value: v2.value ?? "",
      op: v2.op ?? "contains",
    },
    exp: {
      days: expDays,
      to_pipeline_id: exp_to_pipeline_id,
      to_status_id: exp_to_status_id,
    },
  };

  // Зберегти саму кампанію
  await kvSet(`campaigns:${id}`, item);
  // Додати в індекс (score = created_at)
  await kvZAdd("campaigns:index", created_at, id);

  return NextResponse.json({ ok: true, id, item }, { status: 201 });
}
