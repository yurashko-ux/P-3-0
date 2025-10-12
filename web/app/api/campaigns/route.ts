// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
import { campaignKeys, kvGet, kvRead, kvZRange } from '@/lib/kv';
import type { Campaign as StoredCampaign } from './create/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type AnyObj = Record<string, any>;

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNullable(value: unknown): string | null {
  const s = asString(value);
  return s ? s : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCondition(input: any): StoredCampaign['v1_condition'] {
  if (!input) return null;
  const value = asString(input.value ?? input.v ?? input.text ?? input); // legacy fallbacks
  if (!value) return null;
  const op = input.op === 'equals' ? 'equals' : 'contains';
  const field = input.field === 'text' ? 'text' : 'any';
  return { field, op, value };
}

function normalizeExp(raw: AnyObj | null | undefined, baseDays: number): StoredCampaign['exp'] {
  if (!raw) {
    return {
      days: baseDays,
      to_pipeline_id: null,
      to_status_id: null,
      to_pipeline_name: null,
      to_status_name: null,
    };
  }
  return {
    days: asNumber(raw.days ?? raw.exp_days ?? baseDays, baseDays),
    to_pipeline_id: asNullable(raw.to_pipeline_id ?? raw.pipeline_id ?? raw.pipeline),
    to_status_id: asNullable(raw.to_status_id ?? raw.status_id ?? raw.status),
    to_pipeline_name: asNullable(raw.to_pipeline_name ?? raw.pipelineName),
    to_status_name: asNullable(raw.to_status_name ?? raw.statusName),
  };
}

function normalizeCampaign(raw: AnyObj): StoredCampaign | null {
  if (!raw) return null;

  const id = asString(raw.id || raw.__index_id);
  if (!id) return null;

  const createdAt = asNumber(raw.created_at ?? raw.createdAt ?? Date.now(), Date.now());
  const v1Cond = raw.v1_condition ?? raw.rules?.v1 ?? { value: raw.v1, op: raw.v1_op, field: raw.v1_field };
  const v2Cond = raw.v2_condition ?? raw.rules?.v2 ?? (raw.v2 ? { value: raw.v2, op: raw.v2_op, field: raw.v2_field } : null);

  const expDays = asNumber(raw.exp_days ?? raw.expDays ?? raw.exp ?? raw.expireDays ?? raw.vexp, 0);

  const campaign: StoredCampaign = {
    id,
    created_at: createdAt,
    name: asString(raw.name) || 'Без назви',
    base_pipeline_id: asString(
      raw.base_pipeline_id ?? raw.base?.pipeline ?? raw.pipeline_id ?? ''
    ),
    base_status_id: asString(
      raw.base_status_id ?? raw.base?.status ?? raw.status_id ?? ''
    ),
    base_pipeline_name: asNullable(raw.base_pipeline_name ?? raw.base?.pipelineName),
    base_status_name: asNullable(raw.base_status_name ?? raw.base?.statusName),
    v1_condition: normalizeCondition(v1Cond),
    v1_to_pipeline_id: asNullable(
      raw.v1_to_pipeline_id ?? raw.target1?.pipeline ?? raw.t1?.pipeline ?? raw.v1_pipeline
    ),
    v1_to_status_id: asNullable(
      raw.v1_to_status_id ?? raw.target1?.status ?? raw.t1?.status ?? raw.v1_status
    ),
    v1_to_pipeline_name: asNullable(
      raw.v1_to_pipeline_name ?? raw.target1?.pipelineName ?? raw.t1?.pipelineName
    ),
    v1_to_status_name: asNullable(
      raw.v1_to_status_name ?? raw.target1?.statusName ?? raw.t1?.statusName
    ),
    v2_condition: normalizeCondition(v2Cond),
    v2_to_pipeline_id: asNullable(
      raw.v2_to_pipeline_id ?? raw.target2?.pipeline ?? raw.t2?.pipeline ?? raw.v2_pipeline
    ),
    v2_to_status_id: asNullable(
      raw.v2_to_status_id ?? raw.target2?.status ?? raw.t2?.status ?? raw.v2_status
    ),
    v2_to_pipeline_name: asNullable(
      raw.v2_to_pipeline_name ?? raw.target2?.pipelineName ?? raw.t2?.pipelineName
    ),
    v2_to_status_name: asNullable(
      raw.v2_to_status_name ?? raw.target2?.statusName ?? raw.t2?.statusName
    ),
    exp_days: expDays,
    exp_to_pipeline_id: asNullable(
      raw.exp_to_pipeline_id ?? raw.exp_target?.pipeline ?? raw.texp?.pipeline ?? raw.exp_pipeline
    ),
    exp_to_status_id: asNullable(
      raw.exp_to_status_id ?? raw.exp_target?.status ?? raw.texp?.status ?? raw.exp_status
    ),
    exp_to_pipeline_name: asNullable(
      raw.exp_to_pipeline_name ?? raw.exp_target?.pipelineName ?? raw.texp?.pipelineName
    ),
    exp_to_status_name: asNullable(
      raw.exp_to_status_name ?? raw.exp_target?.statusName ?? raw.texp?.statusName
    ),
    rules: {
      v1: normalizeCondition(v1Cond),
      v2: normalizeCondition(v2Cond),
    },
    exp: normalizeExp(raw.exp ?? raw.exp_target, expDays),
    enabled: raw.enabled !== false,
    v1_count: asNumber(raw.v1_count ?? raw.counters?.v1, 0),
    v2_count: asNumber(raw.v2_count ?? raw.counters?.v2, 0),
    exp_count: asNumber(raw.exp_count ?? raw.counters?.exp, 0),
    note: asNullable(raw.note),
  };

  if (!campaign.rules.v1) campaign.rules.v1 = campaign.v1_condition;
  if (!campaign.rules.v2) campaign.rules.v2 = campaign.v2_condition;

  return campaign;
}

async function readCampaigns(): Promise<StoredCampaign[]> {
  const ids = await kvZRange(campaignKeys.INDEX_KEY, 0, -1, { rev: true });
  const items: StoredCampaign[] = [];

  if (ids.length) {
    for (const id of ids) {
      const item = await kvGet<StoredCampaign>(campaignKeys.ITEM_KEY(id));
      if (item) {
        const normalized = normalizeCampaign({ ...item, id });
        if (normalized) items.push(normalized);
        continue;
      }
      const legacyRaw = await kvRead.getRaw(campaignKeys.LEGACY_ITEM_KEY(id));
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw);
          const normalized = normalizeCampaign({ ...parsed, id });
          if (normalized) items.push(normalized);
        } catch {}
      }
    }
  } else {
    const fallback = await kvRead.listCampaigns<AnyObj>();
    for (const raw of fallback) {
      const normalized = normalizeCampaign(raw);
      if (normalized) items.push(normalized);
    }
  }

  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return items;
}

export async function GET() {
  const items = await readCampaigns();
  return NextResponse.json({ ok: true, items, total: items.length });
}

export { POST } from './create/route';
