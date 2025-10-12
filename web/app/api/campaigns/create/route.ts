// web/app/api/campaigns/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvSet, kvZAdd, kvWrite, campaignKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Condition = { field: 'text' | 'any'; op: 'contains' | 'equals'; value: string };

type Rules = { v1?: Condition | null; v2?: Condition | null };

type ExpConfig = {
  days: number;
  to_pipeline_id: string | null;
  to_status_id: string | null;
  to_pipeline_name: string | null;
  to_status_name: string | null;
};

export type Campaign = {
  id: string;
  created_at: number;
  name: string;
  base_pipeline_id: string;
  base_status_id: string;
  base_pipeline_name: string | null;
  base_status_name: string | null;
  v1_condition: Condition | null;
  v1_to_pipeline_id: string | null;
  v1_to_status_id: string | null;
  v1_to_pipeline_name: string | null;
  v1_to_status_name: string | null;
  v2_condition: Condition | null;
  v2_to_pipeline_id: string | null;
  v2_to_status_id: string | null;
  v2_to_pipeline_name: string | null;
  v2_to_status_name: string | null;
  exp_days: number;
  exp_to_pipeline_id: string | null;
  exp_to_status_id: string | null;
  exp_to_pipeline_name: string | null;
  exp_to_status_name: string | null;
  rules: Rules;
  exp: ExpConfig | null;
  enabled: boolean;
  v1_count: number;
  v2_count: number;
  exp_count: number;
  note: string | null;
};

function uuid(): string {
  // працює і в edge, і в node
  // @ts-ignore
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;
}

function normStr(value: unknown): string {
  return String(value ?? '').trim();
}

function normNullable(value: unknown): string | null {
  const s = normStr(value);
  return s ? s : null;
}

function normNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeCondition(input: any): Condition | null {
  if (!input) return null;
  const value = normStr(input.value);
  if (!value) return null;
  const op = input.op === 'equals' ? 'equals' : 'contains';
  const field = input.field === 'text' ? 'text' : 'any';
  return { field, op, value };
}

function readAdminSecret(req: NextRequest): string {
  const header = normStr(req.headers.get('x-admin-token'));
  if (header) return header;

  const auth = normStr(req.headers.get('authorization'));
  if (auth) {
    if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '');
    return auth;
  }

  const cookieToken = req.cookies.get('admin_token')?.value || req.cookies.get('admin_pass')?.value || '';
  if (cookieToken) return cookieToken;

  try {
    const url = new URL(req.url);
    const pass = url.searchParams.get('pass');
    if (pass) return normStr(pass);
  } catch {}

  return '';
}

function ensureAuthorized(req: NextRequest): string | null {
  const required = normStr(process.env.ADMIN_PASS || process.env.ADMIN_TOKEN || '');
  if (!required) return null; // режим налаштування — пропускаємо всіх
  const provided = readAdminSecret(req);
  return provided === required ? null : 'unauthorized';
}

export async function POST(req: NextRequest) {
  const authError = ensureAuthorized(req);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const now = Date.now();
  const id = normStr(payload.id) || uuid();

  const base_pipeline_id = normStr(payload.base_pipeline_id);
  const base_status_id = normStr(payload.base_status_id);
  if (!base_pipeline_id || !base_status_id) {
    return NextResponse.json({ ok: false, error: 'base pipeline/status required' }, { status: 400 });
  }

  const campaign: Campaign = {
    id,
    created_at: now,
    name: normStr(payload.name) || 'Без назви',
    base_pipeline_id,
    base_status_id,
    base_pipeline_name: normNullable(payload.base_pipeline_name),
    base_status_name: normNullable(payload.base_status_name),
    v1_condition: normalizeCondition(payload.v1_condition),
    v1_to_pipeline_id: normNullable(payload.v1_to_pipeline_id),
    v1_to_status_id: normNullable(payload.v1_to_status_id),
    v1_to_pipeline_name: normNullable(payload.v1_to_pipeline_name),
    v1_to_status_name: normNullable(payload.v1_to_status_name),
    v2_condition: normalizeCondition(payload.v2_condition),
    v2_to_pipeline_id: normNullable(payload.v2_to_pipeline_id),
    v2_to_status_id: normNullable(payload.v2_to_status_id),
    v2_to_pipeline_name: normNullable(payload.v2_to_pipeline_name),
    v2_to_status_name: normNullable(payload.v2_to_status_name),
    exp_days: Math.max(0, normNumber(payload.exp_days ?? payload.expDays ?? payload.exp, 0)),
    exp_to_pipeline_id: normNullable(payload.exp_to_pipeline_id),
    exp_to_status_id: normNullable(payload.exp_to_status_id),
    exp_to_pipeline_name: normNullable(payload.exp_to_pipeline_name),
    exp_to_status_name: normNullable(payload.exp_to_status_name),
    rules: {
      v1: normalizeCondition(payload.v1_condition),
      v2: normalizeCondition(payload.v2_condition),
    },
    exp: {
      days: Math.max(0, normNumber(payload.exp_days ?? payload.expDays ?? payload.exp, 0)),
      to_pipeline_id: normNullable(payload.exp_to_pipeline_id),
      to_status_id: normNullable(payload.exp_to_status_id),
      to_pipeline_name: normNullable(payload.exp_to_pipeline_name),
      to_status_name: normNullable(payload.exp_to_status_name),
    },
    enabled: Boolean(payload.enabled ?? true),
    v1_count: normNumber(payload.v1_count, 0),
    v2_count: normNumber(payload.v2_count, 0),
    exp_count: normNumber(payload.exp_count, 0),
    note: normNullable(payload.note),
  };

  // синхронізуємо rules.* з v1/v2_condition для зручності споживачів
  if (!campaign.rules.v1) campaign.rules.v1 = campaign.v1_condition;
  if (!campaign.rules.v2) campaign.rules.v2 = campaign.v2_condition;
  if (campaign.exp && !campaign.exp.days) campaign.exp.days = campaign.exp_days;

  try {
    await kvSet(campaignKeys.ITEM_KEY(id), campaign);
    await kvZAdd(campaignKeys.INDEX_KEY, campaign.created_at, id);

    // Legacy сумісність: дублюємо запис у старі ключі, щоб існуючі екрани продовжували працювати.
    try {
      await kvWrite.setRaw(campaignKeys.LEGACY_ITEM_KEY(id), JSON.stringify(campaign));
      await kvWrite.lpush(campaignKeys.LEGACY_INDEX_KEY, id);
    } catch {}
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'kv write failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id }, { status: 201 });
}

