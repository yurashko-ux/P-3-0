// web/app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { kvGet, kvSet, kvZAdd, kvZRevRange } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function str(x: any): string {
  return (x ?? "").toString().trim();
}
function pick<T>(...vals: T[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && (v as any) !== "") return v;
  return undefined;
}

/** Канонічна збірка правил із різних варіантів імен полів */
function normalizeCampaignInput(body: any) {
  const base_pipeline_id = num(
    pick(body.base_pipeline_id, body.basePipelineId, body.base?.pipeline_id, body.base?.pipelineId)
  );
  const base_status_id = num(
    pick(body.base_status_id, body.baseStatusId, body.base?.status_id, body.base?.statusId)
  );

  // V1
  const v1_value = str(
    pick(
      body.rules?.v1?.value,
      body.v1?.value,
      body.v1_value,
      body.rule_v1_value,
      body.rules?.v1_value
    )
  );
  const v1_pipeline_id = num(
    pick(
      body.rules?.v1?.to_pipeline_id,
      body.rules?.v1?.pipeline_id,
      body.v1?.pipeline_id,
      body.v1_pipeline_id,
      body.v1PipelineId
    )
  );
  const v1_status_id = num(
    pick(
      body.rules?.v1?.to_status_id,
      body.rules?.v1?.status_id,
      body.v1?.status_id,
      body.v1_status_id,
      body.v1StatusId
    )
  );
  const v1_field = str(pick(body.rules?.v1?.field, body.v1?.field)) || "text";
  const v1_op = str(pick(body.rules?.v1?.op, body.v1?.op)) || "contains";

  // V2 (необов'язкове)
  const v2_value = str(
    pick(
      body.rules?.v2?.value,
      body.v2?.value,
      body.v2_value,
      body.rule_v2_value,
      body.rules?.v2_value
    )
  );
  const v2_pipeline_id = num(
    pick(
      body.rules?.v2?.to_pipeline_id,
      body.rules?.v2?.pipeline_id,
      body.v2?.pipeline_id,
      body.v2_pipeline_id,
      body.v2PipelineId
    )
  );
  const v2_status_id = num(
    pick(
      body.rules?.v2?.to_status_id,
      body.rules?.v2?.status_id,
      body.v2?.status_id,
      body.v2_status_id,
      body.v2StatusId
    )
  );
  const v2_field = str(pick(body.rules?.v2?.field, body.v2?.field)) || "text";
  const v2_op = str(pick(body.rules?.v2?.op, body.v2?.op)) || "contains";

  // EXP
  const exp_days = num(pick(body.rules?.exp?.days, body.exp?.days, body.exp_days)) ?? 7;
  const exp_to_pipeline_id = num(
    pick(
      body.rules?.exp?.to_pipeline_id,
      body.exp?.to_pipeline_id,
      body.exp_to_pipeline_id,
      body.expPipelineId
    )
  );
  const exp_to_status_id = num(
    pick(
      body.rules?.exp?.to_status_id,
      body.exp?.to_status_id,
      body.exp_to_status_id,
      body.expStatusId
    )
  );

  return {
    name: str(body.name),
    active: !!pick(body.active, body.enabled),
    base_pipeline_id,
    base_status_id,
    // Канонічні правила
    rules: {
      v1: { field: v1_field, op: v1_op, value: v1_value, to_pipeline_id: v1_pipeline_id, to_status_id: v1_status_id },
      v2: v2_value
        ? { field: v2_field, op: v2_op, value: v2_value, to_pipeline_id: v2_pipeline_id, to_status_id: v2_status_id }
        : undefined,
      exp: { days: exp_days, to_pipeline_id: exp_to_pipeline_id, to_status_id: exp_to_status_id },
    },
    // Дублюємо у «плоскі» поля для зворотної сумісності зі списком/редактором
    v1_pipeline_id,
    v1_status_id,
    v2_pipeline_id,
    v2_status_id,
    exp_days,
    exp_to_pipeline_id,
    exp_to_status_id,
  };
}

/** GET /api/campaigns — список кампаній */
export async function GET(req: Request) {
  await assertAdmin(req);
  const ids = (await kvZRevRange("campaigns:index", 0, -1)) ?? [];
  const items: any[] = [];
  for (const id of ids) {
    const c = await kvGet(`campaigns:${id}`).catch(() => null);
    if (c) items.push(c);
  }
  return NextResponse.json({ ok: true, count: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/campaigns — створення кампанії (tolerant-normalize) */
export async function POST(req: Request) {
  await assertAdmin(req);
  const body = await req.json().catch(() => ({}));
  const norm = normalizeCampaignInput(body);

  const id = String(Date.now());
  const ts = Date.now();

  const campaign = {
    id,
    created_at: ts,
    name: norm.name,
    active: norm.active,
    base_pipeline_id: norm.base_pipeline_id,
    base_status_id: norm.base_status_id,
    rules: norm.rules,
    // зворотна сумісність
    v1_pipeline_id: norm.v1_pipeline_id,
    v1_status_id: norm.v1_status_id,
    v2_pipeline_id: norm.v2_pipeline_id,
    v2_status_id: norm.v2_status_id,
    exp_days: norm.exp_days,
    exp_to_pipeline_id: norm.exp_to_pipeline_id,
    exp_to_status_id: norm.exp_to_status_id,
    // лічильники за замовчуванням
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  };

  // Зберігаємо
  await kvSet(`campaigns:${id}`, campaign);
  await kvZAdd("campaigns:index", ts, id);

  return NextResponse.json({ ok: true, id, campaign }, { headers: { "Cache-Control": "no-store" } });
}
