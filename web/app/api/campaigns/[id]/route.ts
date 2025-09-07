// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvDel, kvZrem } from "../../../../lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type Condition =
  | { field: "text" | "flow" | "tag" | "any"; op: "contains" | "equals"; value: string }
  | null;

type Campaign = {
  id: string;
  created_at: string;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  v1_condition: Condition;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;
  v2_condition: Condition;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;
  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;
  note?: string | null;
  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
};

const INDEX = "campaigns:index";
const keyOf = (id: string) => `campaigns:${id}`;

export async function GET(_: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    const item = await kvGet<Campaign>(keyOf(id));
    if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "get failed" }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    const existing = await kvGet<Campaign>(keyOf(id));
    if (!existing) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const b = await req.json().catch(() => ({} as Partial<Campaign>));
    const updated: Campaign = {
      ...existing,
      name: typeof b.name === "string" ? b.name : existing.name,
      enabled: typeof b.enabled === "boolean" ? b.enabled : existing.enabled,
      v1_condition: b.v1_condition ?? existing.v1_condition,
      v1_to_pipeline_id: b.v1_to_pipeline_id ?? existing.v1_to_pipeline_id,
      v1_to_status_id: b.v1_to_status_id ?? existing.v1_to_status_id,
      v2_condition: b.v2_condition ?? existing.v2_condition,
      v2_to_pipeline_id: b.v2_to_pipeline_id ?? existing.v2_to_pipeline_id,
      v2_to_status_id: b.v2_to_status_id ?? existing.v2_to_status_id,
      exp_days: typeof b.exp_days === "number" ? b.exp_days : existing.exp_days,
      exp_to_pipeline_id: b.exp_to_pipeline_id ?? existing.exp_to_pipeline_id,
      exp_to_status_id: b.exp_to_status_id ?? existing.exp_to_status_id,
      note: b.note ?? existing.note,
    };

    await kvSet(keyOf(id), updated);
    return NextResponse.json({ ok: true, item: updated }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "update failed" }, { status: 500 });
  }
}

export async function DELETE(_: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    await kvDel(keyOf(id));
    await kvZrem(INDEX, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "delete failed" }, { status: 500 });
  }
}
