// web/app/api/mc/manychat/route.ts
// ManyChat webhook handler (IG). Migrated to kvRead/kvWrite + LIST index.
// Keeps behavior minimal: normalize payload, read active campaigns, compute rule matches,
// and return a diagnostic response (routing to KeyCRM is done by /api/keycrm/sync/pair).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { findCardSimple } from '@/lib/keycrm-find';
import { ENV as KEYCRM_ENV, keycrmHeaders, keycrmUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type TargetLike = {
  pipeline?: number | string | null;
  status?: number | string | null;
  pipeline_id?: number | string | null;
  status_id?: number | string | null;
  pipelineId?: number | string | null;
  statusId?: number | string | null;
};

type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number | string | null;
  base_status_id?: number | string | null;
  base?: TargetLike | null;
  t1?: TargetLike | null;
  t2?: TargetLike | null;
  texp?: TargetLike | null;
  v1_to_pipeline_id?: number | string | null;
  v1_to_status_id?: number | string | null;
  v2_to_pipeline_id?: number | string | null;
  v2_to_status_id?: number | string | null;
  exp_to_pipeline_id?: number | string | null;
  exp_to_status_id?: number | string | null;
  rules?: { v1?: Rule; v2?: Rule };
  exp?: (TargetLike & Record<string, unknown>) | null;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function normalize(body: any) {
  // Fallback-safe extraction for ManyChat IG → { title, handle, text }
  const title =
    body?.message?.title ??
    body?.data?.title ??
    body?.title ??
    'IG Message';
  const handle =
    body?.subscriber?.username ??
    body?.user?.username ??
    body?.sender?.username ??
    body?.handle ??
    '';
  const text =
    body?.message?.text ??
    body?.data?.text ??
    body?.text ??
    body?.message ??
    '';
  return { title, handle, text };
}

function matchRule(text: string, rule?: Rule): boolean {
  if (!rule || !rule.value) return false;
  const t = (text || '').toLowerCase();
  const v = rule.value.toLowerCase();
  if (rule.op === 'equals') return t === v;
  if (rule.op === 'contains') return t.includes(v);
  return false;
}

type PipelineStatus = { pipelineId: number; statusId: number };

type FindSummary = {
  ok: boolean;
  error?: string;
  hint?: string;
  result?: {
    id: string;
    pipeline_id: number | null;
    status_id: number | null;
    contact_social?: string | null;
    contact_social_name?: string | null;
  } | null;
  stats?: { checked: number; candidates_total: number } | null;
  used?: Record<string, unknown> | null;
};

type MoveSummary = {
  ok: boolean;
  attempt?: string;
  status?: number;
  response?: any;
  error?: string;
  skipped?: string;
  cardId?: string;
  pipeline_id?: number;
  status_id?: number;
  need?: { KEYCRM_API_URL: boolean; KEYCRM_API_TOKEN: boolean };
};

type MoveAttempt = {
  campaignId: string;
  campaignName?: string;
  rule: 'v1' | 'v2' | 'exp';
  target: 't1' | 't2' | 'texp';
  base?: PipelineStatus | null;
  targetPair?: PipelineStatus | null;
  skip?: string;
  searchArgs?: { username: string; pipeline_id: number; status_id: number };
  find?: FindSummary;
  move?: MoveSummary;
};

const TARGET_KEY_MAP: Record<'v1' | 'v2' | 'exp', 't1' | 't2' | 'texp'> = {
  v1: 't1',
  v2: 't2',
  exp: 'texp',
};

function toNumberId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toNumberId(value);
    if (n != null) return n;
  }
  return null;
}

function resolveBase(campaign: Campaign): PipelineStatus | null {
  const pipelineId = firstNumber(
    campaign.base?.pipeline,
    campaign.base?.pipeline_id,
    campaign.base?.pipelineId,
    (campaign as any)?.base_pipeline,
    (campaign as any)?.base_pipelineId,
    campaign.base_pipeline_id
  );
  const statusId = firstNumber(
    campaign.base?.status,
    campaign.base?.status_id,
    campaign.base?.statusId,
    (campaign as any)?.base_status,
    (campaign as any)?.base_statusId,
    campaign.base_status_id
  );
  if (pipelineId == null || statusId == null) return null;
  return { pipelineId, statusId };
}

function resolveTarget(campaign: Campaign, targetKey: 't1' | 't2' | 'texp'): PipelineStatus | null {
  const node =
    targetKey === 't1'
      ? campaign.t1
      : targetKey === 't2'
        ? campaign.t2
        : campaign.texp ?? campaign.exp ?? null;

  const pipelineId = firstNumber(
    node?.pipeline,
    node?.pipeline_id,
    node?.pipelineId,
    targetKey === 't1'
      ? campaign.v1_to_pipeline_id
      : targetKey === 't2'
        ? campaign.v2_to_pipeline_id
        : campaign.exp_to_pipeline_id,
    targetKey === 't1'
      ? (campaign as any)?.t1_pipeline_id
      : targetKey === 't2'
        ? (campaign as any)?.t2_pipeline_id
        : (campaign as any)?.texp_pipeline_id,
    targetKey === 'texp' ? campaign.exp?.to_pipeline_id : undefined,
    targetKey === 'texp' ? campaign.exp?.pipeline_id : undefined
  );
  const statusId = firstNumber(
    node?.status,
    node?.status_id,
    node?.statusId,
    targetKey === 't1'
      ? campaign.v1_to_status_id
      : targetKey === 't2'
        ? campaign.v2_to_status_id
        : campaign.exp_to_status_id,
    targetKey === 't1'
      ? (campaign as any)?.t1_status_id
      : targetKey === 't2'
        ? (campaign as any)?.t2_status_id
        : (campaign as any)?.texp_status_id,
    targetKey === 'texp' ? campaign.exp?.to_status_id : undefined,
    targetKey === 'texp' ? campaign.exp?.status_id : undefined
  );
  if (pipelineId == null || statusId == null) return null;
  return { pipelineId, statusId };
}

function summarizeFind(res: any): FindSummary {
  if (!res || typeof res !== 'object') {
    return { ok: false, error: 'invalid_response' };
  }
  const summary: FindSummary = { ok: Boolean(res.ok) };
  if (!res.ok) {
    if (res.error) summary.error = String(res.error);
    if (res.hint) summary.hint = String(res.hint);
    return summary;
  }

  const result = res.result
    ? {
        id: String(res.result.id ?? ''),
        pipeline_id: toNumberId(res.result.pipeline_id),
        status_id: toNumberId(res.result.status_id),
        contact_social: res.result.contact_social ?? null,
        contact_social_name: res.result.contact_social_name ?? null,
      }
    : null;

  summary.result = result;
  summary.stats = res.stats ?? null;
  summary.used = res.used ?? null;
  return summary;
}

type MoveResponse = {
  ok: boolean;
  attempt?: string;
  status?: number;
  response?: any;
  error?: string;
  need?: { KEYCRM_API_URL: boolean; KEYCRM_API_TOKEN: boolean };
};

async function moveCardTo(cardId: string, destination: PipelineStatus): Promise<MoveResponse> {
  const need = {
    KEYCRM_API_URL: Boolean(KEYCRM_ENV.KEYCRM_API_URL),
    KEYCRM_API_TOKEN: Boolean(KEYCRM_ENV.KEYCRM_API_TOKEN),
  };
  if (!need.KEYCRM_API_URL || !need.KEYCRM_API_TOKEN) {
    return { ok: false, error: 'keycrm_env_missing', need };
  }

  const headers = keycrmHeaders();
  const attempts = [
    {
      name: 'cards/{id}/move',
      url: keycrmUrl(`/cards/${encodeURIComponent(cardId)}/move`),
      body: JSON.stringify({ pipeline_id: destination.pipelineId, status_id: destination.statusId }),
    },
    {
      name: 'pipelines/cards/move',
      url: keycrmUrl('/pipelines/cards/move'),
      body: JSON.stringify({
        card_id: cardId,
        pipeline_id: destination.pipelineId,
        status_id: destination.statusId,
      }),
    },
  ];

  let last: MoveResponse = { ok: false, need };

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers,
        body: attempt.body,
        cache: 'no-store',
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}
      const success = res.ok && (parsed == null || parsed.ok === undefined || parsed.ok === true);
      if (success) {
        return {
          ok: true,
          attempt: attempt.name,
          status: res.status,
          response: parsed ?? text,
        };
      }
      last = {
        ok: false,
        attempt: attempt.name,
        status: res.status,
        response: parsed ?? text,
        need,
      };
    } catch (err: any) {
      last = {
        ok: false,
        attempt: attempt.name,
        error: err?.message ?? String(err),
        need,
      };
    }
  }

  return last;
}

async function processCampaignMatch(
  campaign: Campaign,
  rule: 'v1' | 'v2' | 'exp',
  norm: { handle: string },
  base: PipelineStatus | null,
): Promise<MoveAttempt> {
  const targetKey = TARGET_KEY_MAP[rule];
  const attempt: MoveAttempt = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    rule,
    target: targetKey,
    base,
    targetPair: resolveTarget(campaign, targetKey),
  };

  if (!norm.handle || !norm.handle.trim()) {
    attempt.skip = 'missing_handle';
    return attempt;
  }
  if (!base) {
    attempt.skip = 'missing_base_pair';
    return attempt;
  }
  if (!attempt.targetPair) {
    attempt.skip = 'missing_target_pair';
    return attempt;
  }

  const searchArgs = {
    username: norm.handle,
    pipeline_id: base.pipelineId,
    status_id: base.statusId,
    scope: 'campaign' as const,
    social_name: 'instagram',
    strategy: 'social' as const,
  };
  attempt.searchArgs = { username: norm.handle, pipeline_id: base.pipelineId, status_id: base.statusId };

  let searchRes: any;
  try {
    searchRes = await findCardSimple(searchArgs);
  } catch (err: any) {
    searchRes = { ok: false, error: err?.message ?? String(err) };
  }

  const summary = summarizeFind(searchRes);
  attempt.find = summary;

  if (!summary.ok) {
    attempt.move = { ok: false, error: summary.error || 'find_failed' };
    return attempt;
  }

  if (!summary.result) {
    attempt.move = { ok: false, error: 'card_not_found' };
    return attempt;
  }

  const cardId = summary.result.id;
  if (!cardId) {
    attempt.move = { ok: false, error: 'card_id_missing' };
    return attempt;
  }
  const currentPipeline = summary.result.pipeline_id;
  const currentStatus = summary.result.status_id;

  if (
    currentPipeline != null &&
    currentStatus != null &&
    currentPipeline === attempt.targetPair.pipelineId &&
    currentStatus === attempt.targetPair.statusId
  ) {
    attempt.move = {
      ok: true,
      skipped: 'already_in_target',
      cardId,
      pipeline_id: currentPipeline,
      status_id: currentStatus,
    };
    return attempt;
  }

  const move = await moveCardTo(cardId, attempt.targetPair);
  attempt.move = {
    ok: move.ok,
    attempt: move.attempt,
    status: move.status,
    response: move.response,
    error: move.error,
    cardId,
    pipeline_id: attempt.targetPair.pipelineId,
    status_id: attempt.targetPair.statusId,
    need: move.need,
  };

  return attempt;
}

export async function POST(req: NextRequest) {
  // Optional verification of ManyChat secret if you use it:
  const mcToken = process.env.MC_TOKEN;
  const headerToken = req.headers.get('x-mc-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (mcToken && headerToken && headerToken !== mcToken) {
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const norm = normalize(payload);

  // Read campaigns via LIST index
  const campaigns = (await kvRead.listCampaigns()) as Campaign[];
  const active = campaigns.filter((c) => c.active !== false);

  const text = norm.text || '';
  const evaluated = active
    .map((campaign) => {
      const v1 = matchRule(text, campaign.rules?.v1);
      const v2 = matchRule(text, campaign.rules?.v2);
      const applied: 'v1' | 'v2' | null = v1 ? 'v1' : v2 ? 'v2' : null;
      const base = resolveBase(campaign);
      const target = applied ? TARGET_KEY_MAP[applied] : null;

      return {
        campaign,
        base,
        match: {
          id: campaign.id,
          name: campaign.name,
          v1,
          v2,
          applied,
          target,
          base,
        },
      };
    })
    .filter((entry) => entry.match.v1 || entry.match.v2);

  const matches = evaluated.map((entry) => entry.match);

  const routing: MoveAttempt[] = [];
  for (const entry of evaluated) {
    if (!entry.match.applied) continue;
    const attempt = await processCampaignMatch(entry.campaign, entry.match.applied, norm, entry.base ?? null);
    routing.push(attempt);
  }

  // (Optional) very light logging to help with diagnostics:
  try {
    const logKey = `logs:mc:${new Date().toISOString().slice(0, 10)}`; // per-day key
    const record = JSON.stringify({
      ts: Date.now(),
      norm,
      matchesCount: matches.length,
      appliedRules: matches.map((m) => m.applied).filter(Boolean),
      routingCount: routing.length,
    });
    // Use LPUSH for logs (best-effort; ignore errors)
    await kvWrite.lpush(logKey, record);
  } catch {
    // ignore log errors
  }

  return NextResponse.json({
    ok: true,
    normalized: norm,
    matches,
    routing,
    totals: { campaigns: campaigns.length, active: active.length },
  });
}

// Optionally allow GET for quick ping/health
export async function GET() {
  const ids = await kvRead.lrange(campaignKeys.INDEX_KEY, 0, 9);
  return NextResponse.json({
    ok: true,
    info: 'ManyChat webhook endpoint',
    previewIndexHead: ids,
  });
}
