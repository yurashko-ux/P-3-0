// web/app/api/campaigns/create/route.ts
import { NextResponse } from "next/server";
import { kvSet, kvZAdd } from "@/lib/kv";
import { assertVariantsUniqueOrThrow } from "@/lib/campaigns-unique";

export const dynamic = "force-dynamic";

/** ---- helpers: tolerant coercion of rules ---- */
type RuleInput =
  | string
  | number
  | null
  | undefined
  | { value?: string | number; field?: string; op?: string };

type VariantRule = { field: "text"; op: "contains" | "equals"; value: string };

function coerceString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function coerceRule(input: RuleInput): VariantRule | undefined {
  if (input === null || input === undefined) return undefined;

  // allow short form: v1: "hi" | 1
  let value =
    typeof input === "object" && "value" in (input as any)
      ? coerceString((input as any).value)
      : coerceString(input);

  if (!value) return undefined;

  // defaults
  let op: "contains" | "equals" =
    typeof input === "object" && "op" in (input as any)
      ? ((String((input as any).op).toLowerCase() as any) === "equals"
          ? "equals"
          : "contains")
      : "contains";

  return { field: "text", op, value };
}

/** ---- route handler ---- */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // tolerate different shapes and coerce everything to strings
  const v1 = coerceRule(body?.rules?.v1 ?? body?.v1);
  const v2 = coerceRule(body?.rules?.v2 ?? body?.v2);

  if (!v1?.value) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  // Uniqueness check across all non-deleted campaigns
  await assertVariantsUniqueOrThrow({
    v1,
    v2,
    // excludeId is undefined here (create flow)
  });

  const id = Date.now(); // simple unique id
  const now = new Date().toISOString();

  const created = {
    id,
    name: coerceString(body?.name) ?? "",
    base_pipeline_id: Number(body?.base_pipeline_id ?? body?.base?.pipeline_id ?? 0) || 0,
    base_status_id: Number(body?.base_status_id ?? body?.base?.status_id ?? 0) || 0,
    rules: { v1, ...(v2 ? { v2 } : {}) },
    expire:
      body?.expire && (body?.expire?.days || body?.expire_days)
        ? {
            days: Number(body?.expire?.days ?? body?.expire_days) || 0,
            to_pipeline_id: Number(
              body?.expire?.to_pipeline_id ?? body?.expire_to_pipeline_id ?? 0
            ) || 0,
            to_status_id: Number(
              body?.expire?.to_status_id ?? body?.expire_to_status_id ?? 0
            ) || 0,
          }
        : undefined,
    active: true,
    created_at: now,
    updated_at: now,
    // counters
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
    deleted: false,
  };

  // persist
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", Date.now(), String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
