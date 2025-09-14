// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRange } from "@/lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type VariantOp = "contains" | "equals";

type CampaignRule = {
  field: "text";
  op: VariantOp;
  value: string;
};

type Campaign = {
  id: string;
  name: string;
  active: boolean;
  base_pipeline_id: number | string;
  base_status_id: number | string;
  rules: {
    v1: CampaignRule;
    v2?: CampaignRule | null;
  };
  expire?: {
    days?: number;
    to_pipeline_id?: number | string;
    to_status_id?: number | string;
  } | null;
  counters?: {
    v1_count?: number;
    v2_count?: number;
    exp_count?: number;
  } | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
};

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

// ---------- GET /api/campaigns ----------
// Повертає ВСІ кампанії, відсортовані від нових до старих.
// Якщо треба буде — згодом додамо ?active=1
export async function GET(req: Request) {
  await assertAdmin(req);

  // читаємо весь індекс (asc) і реверсимо локально
  const ids = (await kvZRange("campaigns:index", 0, -1)) ?? [];
  const rev = [...ids].reverse();

  const out: Campaign[] = [];
  for (const id of rev) {
    const raw = await kvGet(`campaigns:${id}`);
    if (!raw) continue;
    try {
      const c: Campaign = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (c?.deleted_at) continue; // ховаємо мʼяко видалені
      out.push(c);
    } catch {
      // пропускаємо биті записи
    }
  }

  return NextResponse.json({ ok: true, data: out });
}

// ---------- POST /api/campaigns ----------
// Створення кампанії з базовою валідацією
export async function POST(req: Request) {
  await assertAdmin(req);
  const body = await req.json();

  const name = String(body?.name ?? "").trim();
  if (!nonEmpty(name)) {
    return NextResponse.json(
      { ok: false, error: "name is required (non-empty)" },
      { status: 400 }
    );
  }

  const v1 = body?.rules?.v1 ?? {};
  const v1Value = String(v1?.value ?? "").trim();
  if (!nonEmpty(v1Value)) {
    return NextResponse.json(
      { ok: false, error: "rules.v1.value is required (non-empty)" },
      { status: 400 }
    );
  }

  const now = Date.now();
  const id = String(now);

  const created: Campaign = {
    id,
    name,
    active: Boolean(body?.active ?? true),
    base_pipeline_id: Number(body?.base_pipeline_id ?? body?.base?.pipeline_id ?? 0),
    base_status_id: Number(body?.base_status_id ?? body?.base?.status_id ?? 0),
    rules: {
      v1: {
        field: "text",
        op: (v1?.op as VariantOp) ?? "contains",
        value: v1Value,
      },
      v2: body?.rules?.v2 && nonEmpty(body?.rules?.v2?.value)
        ? {
            field: "text",
            op: (body.rules.v2.op as VariantOp) ?? "contains",
            value: String(body.rules.v2.value).trim(),
          }
        : null,
    },
    expire: body?.expire ?? null,
    counters: { v1_count: 0, v2_count: 0, exp_count: 0 },
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  // Запис у KV
  await kvSet(`campaigns:${id}`, created);
  await kvZAdd("campaigns:index", now, id);

  return NextResponse.json({ ok: true, data: created }, { status: 201 });
}
