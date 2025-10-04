// web/app/api/mc/manychat/route.ts
// ManyChat webhook handler (IG). Migrated to kvRead/kvWrite + LIST index.
// Keeps behavior minimal: normalize payload, read active campaigns, compute rule matches,
// and return a diagnostic response (routing to KeyCRM is done by /api/keycrm/sync/pair).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { findCardSimple } from '@/lib/keycrm-find';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  base?: { pipeline?: string | number | null; status?: string | number | null };
  v1_to_pipeline_id?: string | number | null;
  v1_to_status_id?: string | number | null;
  v2_to_pipeline_id?: string | number | null;
  v2_to_status_id?: string | number | null;
  exp_to_pipeline_id?: string | number | null;
  exp_to_status_id?: string | number | null;
  t1?: { pipeline?: string | number | null; status?: string | number | null };
  t2?: { pipeline?: string | number | null; status?: string | number | null };
  texp?: { pipeline?: string | number | null; status?: string | number | null };
  rules?: { v1?: Rule; v2?: Rule; exp?: Rule };
  exp?: Record<string, unknown>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

type MatchResult = {
  id: string;
  name: string;
  v1: boolean;
  v2: boolean;
  vexp: boolean;
  rule: 'v1' | 'v2' | 'texp';
};

type MoveAttempt = {
  attempt: string;
  status: number;
  ok: boolean;
  responseText?: string;
  responseJson?: any;
  error?: string;
};

type MoveResult = {
  ok: boolean;
  attempt?: string;
  status?: number;
  responseText?: string;
  responseJson?: any;
  error?: string;
  attempts: MoveAttempt[];
};

type ActionLog = {
  campaignId: string;
  campaignName: string;
  rule: 'v1' | 'v2' | 'texp';
  base?: { pipeline: number | null; status: number | null };
  target?: { pipeline: string | null; status: string | null };
  handle?: string;
  search?: {
    ok: boolean;
    cardId: string | null;
    stats?: { checked: number; candidates_total: number };
    error?: string;
  };
  move?: MoveResult;
  error?: string;
};

const KEYCRM_BASE = (process.env.KEYCRM_BASE_URL || process.env.KEYCRM_API_URL || '').replace(/\/+$/, '');
const KEYCRM_TOKEN = process.env.KEYCRM_API_TOKEN || '';

function toNumber(input: any): number | null {
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

function toStringId(input: any): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  return s ? s : null;
}

function normalizeHandle(raw: string | null | undefined): string {
  const stripped = (raw || '').trim().replace(/^@+/, '').toLowerCase();
  return stripped ? `@${stripped}` : '';
}

function pickTarget(
  campaign: Campaign,
  key: 'v1' | 'v2' | 'texp'
): { pipeline: string | null; status: string | null } {
  if (key === 'v1') {
    return {
      pipeline:
        toStringId(campaign.t1?.pipeline) ??
        toStringId((campaign as any).t1?.pipeline_id) ??
        toStringId(campaign.v1_to_pipeline_id),
      status:
        toStringId(campaign.t1?.status) ??
        toStringId((campaign as any).t1?.status_id) ??
        toStringId(campaign.v1_to_status_id),
    };
  }
  if (key === 'v2') {
    return {
      pipeline:
        toStringId(campaign.t2?.pipeline) ??
        toStringId((campaign as any).t2?.pipeline_id) ??
        toStringId(campaign.v2_to_pipeline_id),
      status:
        toStringId(campaign.t2?.status) ??
        toStringId((campaign as any).t2?.status_id) ??
        toStringId(campaign.v2_to_status_id),
    };
  }
  return {
    pipeline:
      toStringId(campaign.texp?.pipeline) ??
      toStringId((campaign as any).texp?.pipeline_id) ??
      toStringId(campaign.exp_to_pipeline_id),
    status:
      toStringId(campaign.texp?.status) ??
      toStringId((campaign as any).texp?.status_id) ??
      toStringId(campaign.exp_to_status_id),
  };
}

async function moveCard(cardId: string, toPipeline: string, toStatus: string): Promise<MoveResult> {
  if (!KEYCRM_BASE || !KEYCRM_TOKEN) {
    return {
      ok: false,
      error: 'keycrm_not_configured',
      attempts: [],
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${KEYCRM_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const attemptsConfig = [
    {
      name: 'cards/{id}/move',
      url: `${KEYCRM_BASE}/cards/${encodeURIComponent(cardId)}/move`,
      payload: { pipeline_id: toPipeline, status_id: toStatus },
    },
    {
      name: 'pipelines/cards/move',
      url: `${KEYCRM_BASE}/pipelines/cards/move`,
      payload: { card_id: cardId, pipeline_id: toPipeline, status_id: toStatus },
    },
  ];

  const attempts: MoveAttempt[] = [];

  for (const attempt of attemptsConfig) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(attempt.payload),
        cache: 'no-store',
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}

      const success = res.ok && (json == null || json.ok === undefined || json.ok === true);
      attempts.push({
        attempt: attempt.name,
        status: res.status,
        ok: success,
        responseText: success ? undefined : text,
        responseJson: json,
        error: success ? undefined : json?.error,
      });
      if (success) {
        return {
          ok: true,
          attempt: attempt.name,
          status: res.status,
          responseJson: json ?? undefined,
          attempts,
        };
      }
    } catch (err: any) {
      attempts.push({
        attempt: attempt.name,
        status: 0,
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    attempt: last?.attempt,
    status: last?.status,
    responseText: last?.responseText,
    responseJson: last?.responseJson,
    error: last?.error || 'move_failed',
    attempts,
  };
}

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
  const active = campaigns.filter(c => c.active !== false);
  const campaignById = new Map(active.map((c) => [String(c.id), c]));

  // Compute matches with rule priority (v2 > v1 > exp)
  const text = norm.text || '';
  const matches: MatchResult[] = [];
  for (const c of active) {
    const v1 = matchRule(text, c.rules?.v1);
    const v2 = matchRule(text, c.rules?.v2);
    const vexp = matchRule(text, c.rules?.exp);
    let rule: MatchResult['rule'] | null = null;
    if (v2) rule = 'v2';
    else if (v1) rule = 'v1';
    else if (vexp) rule = 'texp';
    if (rule) {
      matches.push({ id: c.id, name: c.name, v1, v2, vexp, rule });
    }
  }

  // Attempt to resolve and move cards in KeyCRM for each match
  const normalizedHandle = normalizeHandle(norm.handle);
  const actions: ActionLog[] = [];

  for (const match of matches) {
    const campaign = campaignById.get(String(match.id));
    const action: ActionLog = {
      campaignId: match.id,
      campaignName: match.name,
      rule: match.rule,
    };

    if (normalizedHandle) {
      action.handle = normalizedHandle;
    }

    if (!campaign) {
      action.error = 'campaign_not_found';
      actions.push(action);
      continue;
    }

    const basePipeline = toNumber(campaign.base?.pipeline ?? campaign.base_pipeline_id);
    const baseStatus = toNumber(campaign.base?.status ?? campaign.base_status_id);
    action.base = { pipeline: basePipeline, status: baseStatus };

    if (basePipeline == null || baseStatus == null) {
      action.error = 'missing_base_scope';
      actions.push(action);
      continue;
    }

    if (!normalizedHandle) {
      action.error = 'missing_handle';
      actions.push(action);
      continue;
    }

    let searchResult: Awaited<ReturnType<typeof findCardSimple>>;
    try {
      searchResult = await findCardSimple({
        username: normalizedHandle,
        social_name: 'instagram',
        scope: 'campaign',
        pipeline_id: basePipeline,
        status_id: baseStatus,
        strategy: 'social',
      });
    } catch (err: any) {
      action.search = {
        ok: false,
        cardId: null,
        error: err?.message || 'search_failed',
      };
      action.error = 'search_failed';
      actions.push(action);
      continue;
    }

    action.search = {
      ok: searchResult.ok,
      cardId: searchResult.result?.id ?? null,
      stats: searchResult.stats,
      error: searchResult.error,
    };

    if (!searchResult.ok || !searchResult.result?.id) {
      action.error = searchResult.error || 'card_not_found';
      actions.push(action);
      continue;
    }

    const target = pickTarget(campaign, match.rule);
    action.target = target;

    if (!target.pipeline || !target.status) {
      action.error = 'missing_target_stage';
      actions.push(action);
      continue;
    }

    const moveResult = await moveCard(searchResult.result.id, target.pipeline, target.status);
    action.move = moveResult;
    if (!moveResult.ok) {
      action.error = moveResult.error || 'move_failed';
    }

    actions.push(action);
  }

  // (Optional) very light logging to help with diagnostics:
  try {
    const logKey = `logs:mc:${new Date().toISOString().slice(0, 10)}`; // per-day key
    const record = JSON.stringify({
      ts: Date.now(),
      norm,
      matchesCount: matches.length,
      actionsAttempted: actions.length,
      movesOk: actions.filter((a) => a.move?.ok).length,
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
    totals: { campaigns: campaigns.length, active: active.length },
    actions,
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
