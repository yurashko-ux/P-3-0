// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvZAdd, kvZRange, cuid } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Condition = { field: 'text'|'flow'|'tag'|'any'; op: 'contains'|'equals'; value: string };
type Campaign = {
  id: string;
  created_at: string;
  name: string;

  base_pipeline_id: string | null;
  base_status_id: string | null;

  v1_condition: Condition | null;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;

  v2_condition: Condition | null;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;

  exp_days: number | null;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;

  note?: string | null;
  enabled: boolean;

  v1_count: number;
  v2_count: number;
  exp_count: number;
};

const INDEX_KEY = 'campaigns:index';
const ITEM_KEY = (id: string) => `campaigns:${id}`;

function ok(data: any, init?: number) { return NextResponse.json(data, { status: init ?? 200 }); }
function bad(message: string, code = 400) { return NextResponse.json({ ok: false, error: message }, { status: code }); }

function toConditionFromFlat(input: any): Condition | null {
  if (!input) return null;
  const field = (input.field || input.v1_field || input.v2_field) as Condition['field'] | undefined;
  const op = (input.op || input.v1_op || input.v2_op) as Condition['op'] | undefined;
  const value = (input.value ?? input.v1_value ?? input.v2_value ?? '').toString();
  if (!field || field === 'any') return { field: 'any', op: 'contains', value: '' };
  if (!op) return { field, op: 'contains', value };
  return { field, op, value };
}

function normalizePayload(body: any): Campaign {
  const id = body.id || cuid();
  const created_at = new Date().toISOString();
  const enabled = body.enabled !== false;

  // приймаємо як нову форму (v1_field/op/value), так і стару (v1_condition)
  const v1_condition = body.v1_condition ?? toConditionFromFlat({
    field: body.v1_field, op: body.v1_op, value: body.v1_value,
  });
  const v2_enabled = body.v2_enabled ?? (body.v2_condition ? true : false);
  const v2_condition = v2_enabled
    ? (body.v2_condition ?? toConditionFromFlat({ field: body.v2_field, op: body.v2_op, value: body.v2_value }))
    : null;

  const item: Campaign = {
    id,
    created_at,
    name: String(body.name || '').trim(),

    base_pipeline_id: body.base_pipeline_id ? String(body.base_pipeline_id) : null,
    base_status_id: body.base_status_id ? String(body.base_status_id) : null,

    v1_condition,
    v1_to_pipeline_id: body.v1_to_pipeline_id ? String(body.v1_to_pipeline_id) : null,
    v1_to_status_id: body.v1_to_status_id ? String(body.v1_to_status_id) : null,

    v2_condition,
    v2_to_pipeline_id: v2_enabled && body.v2_to_pipeline_id ? String(body.v2_to_pipeline_id) : null,
    v2_to_status_id: v2_enabled && body.v2_to_status_id ? String(body.v2_to_status_id) : null,

    exp_days: Number.isFinite(Number(body.exp_days)) ? Number(body.exp_days) : null,
    exp_to_pipeline_id: body.exp_to_pipeline_id ? String(body.exp_to_pipeline_id) : null,
    exp_to_status_id: body.exp_to_status_id ? String(body.exp_to_status_id) : null,

    note: body.note ? String(body.note) : null,
    enabled,

    v1_count: Number(body.v1_count ?? 0) || 0,
    v2_count: Number(body.v2_count ?? 0) || 0,
    exp_count: Number(body.exp_count ?? 0) || 0,
  };
  return item;
}

/** GET /api/campaigns -> { ok:true, items: Campaign[] } */
export async function GET() {
  try {
    const ids = await kvZRange(INDEX_KEY, 0, -1);
    const items: Campaign[] = [];
    for (const id of ids) {
      const raw = await kvGet(ITEM_KEY(id));
      if (!raw) continue;
      try { items.push(JSON.parse(raw)); } catch {}
    }
    // newest first (на випадок, якщо KV повернув не відсортований)
    items.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    return ok({ ok: true, items });
  } catch (e: any) {
    return bad(e?.message || 'failed to list', 500);
  }
}

/** POST /api/campaigns -> створення */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const draft = normalizePayload(body);

    // Валідація мінімуму згідно ТЗ
    if (!draft.name) return bad('name is required', 400);
    if (!draft.base_pipeline_id || !draft.base_status_id) return bad('base pipeline/status required', 400);
    if (!draft.v1_to_pipeline_id || !draft.v1_to_status_id) return bad('v1 target required', 400);
    if (draft.exp_days == null) return bad('exp_days required', 400);

    // Зберігаємо
    const json = JSON.stringify(draft);
    await kvSet(ITEM_KEY(draft.id), json);
    await kvZAdd(INDEX_KEY, Date.now(), draft.id);

    return ok({ ok: true, id: draft.id, item: draft }, 201);
  } catch (e: any) {
    return bad(e?.message || 'failed to create', 500);
  }
}
