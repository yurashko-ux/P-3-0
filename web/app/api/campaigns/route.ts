// web/app/api/campaigns/route.ts
// (нагадую) Толерантний POST + індекс; GET повертає список
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvZadd, kvZrevrange } from "../../../lib/kv";

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

function pick<T = any>(o: any, keys: string[], def?: any): T {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null) return o[k] as T;
  }
  return def as T;
}
function toNum(x: any): number | null {
  if (x === "" || x === undefined || x === null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

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
    const b = (await req.json().catch(() => ({}))) as Record<string, any>;

    const name = pick<string>(b, ["name"]);
    const base_pipeline_id =
      pick<string>(b, ["base_pipeline_id", "basePipelineId"]) ??
      pick<string>(b.base ?? {}, ["pipeline_id", "pipelineId"]);
    const base_status_id =
      pick<string>(b, ["base_status_id", "baseStatusId"]) ??
      pick<string>(b.base ?? {}, ["status_id", "statusId"]);

    const v1_condition: Condition =
      pick(b, ["v1_condition", "v1Condition"], null) ?? null;
    const v1_to_pipeline_id =
      pick<string | null>(b, ["v1_to_pipeline_id", "v1ToPipelineId"], null);
    const v1_to_status_id =
      pick<string | null>(b, ["v1_to_status_id", "v1ToStatusId"], null);

    const v2_condition: Condition =
      pick(b, ["v2_condition", "v2Condition"], null) ?? null;
    const v2_to_pipeline_id =
      pick<string | null>(b, ["v2_to_pipeline_id", "v2ToPipelineId"], null);
    const v2_to_status_id =
      pick<string | null>(b, ["v2_to_status_id", "v2ToStatusId"], null);

    const exp_days_raw =
      pick(b, ["exp_days", "expDays", "expiration_days", "expirationDays"], null) ??
      pick(b.expiration ?? {}, ["days", "exp_days"], null);
    const exp_days = toNum(exp_days_raw);

    const exp_to_pipeline_id =
      pick<string | null>(b, ["exp_to_pipeline_id", "expToPipelineId"], null);
    const exp_to_status_id =
      pick<string | null>(b, ["exp_to_status_id", "expToStatusId"], null);

    const note = pick<string | null>(b, ["note"], null);
    const enabled = pick<boolean>(b, ["enabled"], true);

    const errors: string[] = [];
    if (!name) errors.push("name");
    if (!base_pipeline_id) errors.push("base_pipeline_id");
    if (!base_status_id) errors.push("base_status_id");
    if (exp_days === null || exp_days < 0) errors.push("exp_days");

    if (errors.length) {
      return NextResponse.json(
        { ok: false, error: "missing/invalid fields", fields: errors },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const item: Campaign = {
      id,
      created_at: now,
      name: String(name),
      base_pipeline_id: String(base_pipeline_id),
      base_status_id: String(base_status_id),
      v1_condition,
      v1_to_pipeline_id: v1_to_pipeline_id ?? null,
      v1_to_status_id: v1_to_status_id ?? null,
      v2_condition,
      v2_to_pipeline_id: v2_to_pipeline_id ?? null,
      v2_to_status_id: v2_to_status_id ?? null,
      exp_days: Number(exp_days),
      exp_to_pipeline_id: exp_to_pipeline_id ?? null,
      exp_to_status_id: exp_to_status_id ?? null,
      note,
      enabled: Boolean(enabled),
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    };

    await kvSet(keyOf(id), item);
    await kvZadd(INDEX, Date.now(), id);

    return NextResponse.json({ ok: true, id, item }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "save failed" }, { status: 500 });
  }
}
