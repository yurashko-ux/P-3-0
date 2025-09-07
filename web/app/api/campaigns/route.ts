// web/app/api/campaigns/route.ts
// Fallback: відносний імпорт, щоб білд точно пройшов навіть без alias.
import { kvGet, kvSet, kvZadd, kvZrevrange } from "../../../lib/kv";
import { NextResponse } from "next/server";

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

export async function GET() {
  try {
    const ids = await kvZrevrange(INDEX, 0, 199);
    const items: Campaign[] = [];
    for (const id of ids) {
      const it = await kvGet<Campaign>(keyOf(id));
      if (it) items.push(it);
    }
    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "KV error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();

    if (!b?.name || !b?.base_pipeline_id || !b?.base_status_id || b?.exp_days == null) {
      return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const item: Campaign = {
      id,
      created_at: now,
      name: String(b.name),
      base_pipeline_id: String(b.base_pipeline_id),
      base_status_id: String(b.base_status_id),
      v1_condition: b.v1_condition ?? null,
      v1_to_pipeline_id: b.v1_to_pipeline_id ?? null,
      v1_to_status_id: b.v1_to_status_id ?? null,
      v2_condition: b.v2_condition ?? null,
      v2_to_pipeline_id: b.v2_to_pipeline_id ?? null,
      v2_to_status_id: b.v2_to_status_id ?? null,
      exp_days: Number(b.exp_days),
      exp_to_pipeline_id: b.exp_to_pipeline_id ?? null,
      exp_to_status_id: b.exp_to_status_id ?? null,
      note: b.note ?? null,
      enabled: b.enabled ?? true,
      v1_count: 0,
      v2_count: 0,
      exp_count: 0
    };

    await kvSet(keyOf(id), item);
    await kvZadd(INDEX, Date.now(), id);

    return NextResponse.json({ ok: true, id, item }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "save failed" }, { status: 500 });
  }
}
