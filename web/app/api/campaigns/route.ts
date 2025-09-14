// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZRevRange, kvZAdd } from "@/lib/kv";
import { z } from "zod";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type RuleOp = "contains" | "equals";
type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  base_pipeline_id: number;
  base_status_id: number;
  rules: {
    v1: { field: "text"; op: RuleOp; value: string };
    v2?: { field: "text"; op: RuleOp; value: string };
  };
  exp_days?: number;
  exp_to_pipeline_id?: number;
  exp_to_status_id?: number;
  created_at: number;
  updated_at: number;
};

// ---------- helpers
function safeJSON<T>(raw: unknown): T | null {
  if (raw == null) return null;
  try {
    if (typeof raw === "string") return JSON.parse(raw) as T;
    return raw as T;
  } catch {
    return null;
  }
}

const RuleSchema = z.object({
  field: z.literal("text").optional().default("text"),
  op: z.enum(["contains", "equals"] as const).default("contains"),
  // важливо: будь-що → у String → trim → не порожнє
  value: z
    .preprocess((v) => String(v ?? ""), z.string())
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "rules.v1.value is required (non-empty)"),
});

const OptionalRuleSchema = z
  .object({
    field: z.literal("text").optional().default("text"),
    op: z.enum(["contains", "equals"] as const).default("contains"),
    value: z
      .preprocess((v) => String(v ?? ""), z.string())
      .transform((s) => s.trim()),
  })
  // якщо value порожній — вважаємо, що v2 відсутній
  .transform((r) => (r.value ? r : undefined));

const CreateSchema = z.object({
  name: z.string().transform((s) => s.trim()).min(1, "name is required"),
  active: z.coerce.boolean().optional().default(true),
  base_pipeline_id: z.coerce.number(),
  base_status_id: z.coerce.number(),
  rules: z.object({
    v1: RuleSchema, // обовʼязково
    v2: OptionalRuleSchema.optional(), // опційно
  }),
  expire: z
    .object({
      days: z.coerce.number().optional(),
      to_pipeline_id: z.coerce.number().optional(),
      to_status_id: z.coerce.number().optional(),
    })
    .optional(),
});

// ---------- GET: список (нові зверху)
export async function GET(req: Request) {
  await assertAdmin(req);

  let ids: string[] = [];
  try {
    const zset = await kvZRevRange("campaigns:index", 0, -1);
    ids = Array.isArray(zset) ? zset.map(String) : [];
  } catch {
    ids = [];
  }

  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet(`campaigns:${id}`);
    const c = safeJSON<Campaign>(raw);
    if (!c) continue;
    (c as any).id = c.id ?? id;
    items.push(c);
  }

  return NextResponse.json({ ok: true, data: items });
}

// ---------- POST: створення
export async function POST(req: Request) {
  await assertAdmin(req);

  let parsed;
  try {
    const body = await req.json();
    parsed = CreateSchema.parse(body);
  } catch (e: any) {
    const msg =
      e?.errors?.[0]?.message ??
      (typeof e?.message === "string" ? e.message : "Bad Request");
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const now = Date.now();
  const id = now.toString(36);

  const v1 = {
    field: "text" as const,
    op: parsed.rules.v1.op,
    value: parsed.rules.v1.value,
  };
  const v2 =
    parsed.rules.v2 && parsed.rules.v2.value
      ? ({
          field: "text",
          op: parsed.rules.v2.op,
          value: parsed.rules.v2.value,
        } as const)
      : undefined;

  const created: Campaign = {
    id,
    name: parsed.name,
    active: parsed.active,
    base_pipeline_id: parsed.base_pipeline_id,
    base_status_id: parsed.base_status_id,
    rules: { v1, ...(v2 ? { v2 } : {}) },
    exp_days: parsed.expire?.days,
    exp_to_pipeline_id: parsed.expire?.to_pipeline_id,
    exp_to_status_id: parsed.expire?.to_status_id,
    created_at: now,
    updated_at: now,
  };

  // зберігаємо
  await kvSet(`campaigns:${id}`, JSON.stringify(created));
  await kvZAdd("campaigns:index", now, String(id));

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
