// web/app/api/mc/manychat/route.ts
// ManyChat webhook handler (IG). Migrated to kvRead/kvWrite + LIST index.
// Keeps behavior minimal: normalize payload, read active campaigns, compute rule matches,
// and return a diagnostic response (routing to KeyCRM is done by /api/keycrm/sync/pair).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { normalizeManyChat } from '@/lib/ingest';
import { findCardSimple } from '@/lib/keycrm-find';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = {
  op: 'contains' | 'equals';
  value: string;
  pipeline_id?: number | null;
  status_id?: number | null;
};
type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  rules?: { v1?: Rule; v2?: Rule };
  exp?: Record<string, unknown>;
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

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function moveCard(cardId: number | string, pipelineId: number, statusId: number) {
  const base = (process.env.KEYCRM_API_URL || process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1').replace(/\/$/, '');
  const token =
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_TOKEN ||
    '';

  if (!token) {
    return { ok: false, error: 'missing_keycrm_token' as const };
  }

  const url = `${base}/crm/deals/${encodeURIComponent(String(cardId))}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pipeline_id: pipelineId,
      status_id: statusId,
    }),
    cache: 'no-store',
  });

  const text = await res.text().catch(() => '');
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }

  if (!res.ok) {
    return { ok: false as const, status: res.status, error: json?.message || text || res.statusText, raw: json ?? text };
  }

  return { ok: true as const, status: res.status, body: json ?? text };
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
  const mcProfile = normalizeManyChat({
    username:
      norm.handle ||
      payload?.subscriber?.username ||
      payload?.user?.username ||
      payload?.sender?.username ||
      payload?.handle ||
      null,
    full_name:
      payload?.subscriber?.full_name ||
      payload?.subscriber?.name ||
      payload?.user?.full_name ||
      payload?.user?.name ||
      payload?.full_name ||
      payload?.name ||
      '',
    first_name: payload?.subscriber?.first_name || payload?.user?.first_name || payload?.first_name || null,
    last_name: payload?.subscriber?.last_name || payload?.user?.last_name || payload?.last_name || null,
  });

  // Read campaigns via LIST index
  const campaigns = (await kvRead.listCampaigns()) as Campaign[];
  const active = campaigns.filter(c => c.active !== false);

  // Compute matches
  const text = norm.text || '';
  const matches = active.map((c) => {
    const v1 = matchRule(text, c.rules?.v1);
    const v2 = matchRule(text, c.rules?.v2);
    const rule: 'v1' | 'v2' | null = v1 && !v2 ? 'v1' : v2 && !v1 ? 'v2' : v1 && v2 ? 'v1' : null;
    return { id: c.id, name: c.name, v1, v2, rule };
  }).filter(m => m.v1 || m.v2);

  const operations: Array<{
    campaignId: string;
    campaignName: string;
    rule: 'v1' | 'v2' | 'both' | null;
    cardId: number | string | null;
    find?: Awaited<ReturnType<typeof findCardSimple>>;
    move?: Awaited<ReturnType<typeof moveCard>> | null;
    basePipelineId?: number | null;
    baseStatusId?: number | null;
    targetPipelineId?: number | null;
    targetStatusId?: number | null;
    skipReason?: string;
  }> = [];

  for (const match of matches) {
    const campaign = active.find((c) => String(c.id) === String(match.id) || String((c as any).__index_id) === String(match.id));
    if (!campaign) continue;

    const basePipelineId = toNumber(campaign.base_pipeline_id);
    const baseStatusId = toNumber(campaign.base_status_id);
    const ruleKey: 'v1' | 'v2' | null = match.rule || (match.v1 ? 'v1' : match.v2 ? 'v2' : null);
    const appliedRule = match.v1 && match.v2 ? 'both' : ruleKey;

    const op = {
      campaignId: String(campaign.id),
      campaignName: campaign.name ?? '',
      rule: appliedRule,
      cardId: null as number | string | null,
      find: undefined as Awaited<ReturnType<typeof findCardSimple>> | undefined,
      move: null as Awaited<ReturnType<typeof moveCard>> | null,
      basePipelineId,
      baseStatusId,
      targetPipelineId: null as number | null,
      targetStatusId: null as number | null,
      skipReason: undefined as string | undefined,
    };

    if (basePipelineId == null || baseStatusId == null) {
      op.skipReason = 'missing_base_pipeline_or_status';
      operations.push(op);
      continue;
    }

    const usernameCandidate = mcProfile.handleRaw || (mcProfile.handle ? `@${mcProfile.handle}` : norm.handle || null);
    const fullNameCandidate = mcProfile.fullName || norm.title || '';

    op.find = await findCardSimple({
      username: usernameCandidate || undefined,
      full_name: fullNameCandidate || undefined,
      pipeline_id: basePipelineId,
      status_id: baseStatusId,
      scope: 'campaign',
      social_name: 'instagram',
    });

    const card = op.find?.ok && op.find?.result?.id ? op.find.result : null;
    if (!card) {
      op.skipReason = op.find?.ok === false ? op.find.error || 'card_lookup_failed' : 'card_not_found';
      operations.push(op);
      continue;
    }

    op.cardId = card.id;

    const targetRule = ruleKey ? (campaign.rules as any)?.[ruleKey] : null;
    const targetPipelineCandidate = toNumber(targetRule?.pipeline_id);
    const targetStatusCandidate = toNumber(targetRule?.status_id);
    const targetPipelineId = targetPipelineCandidate == null ? basePipelineId : targetPipelineCandidate;
    const targetStatusId = targetStatusCandidate == null ? baseStatusId : targetStatusCandidate;
    op.targetPipelineId = targetPipelineId;
    op.targetStatusId = targetStatusId;

    if (targetPipelineId == null || targetStatusId == null) {
      op.skipReason = 'missing_target_pipeline_or_status';
      operations.push(op);
      continue;
    }

    const samePipeline = card.pipeline_id != null && Number(card.pipeline_id) === targetPipelineId;
    const sameStatus = card.status_id != null && Number(card.status_id) === targetStatusId;
    if (samePipeline && sameStatus) {
      op.move = { ok: true as const, status: 200, body: { skipped: 'already_in_target' } };
      operations.push(op);
      continue;
    }

    op.move = await moveCard(card.id, targetPipelineId, targetStatusId);
    operations.push(op);
  }

  // (Optional) very light logging to help with diagnostics:
  try {
    const logKey = `logs:mc:${new Date().toISOString().slice(0, 10)}`; // per-day key
    const record = JSON.stringify({
      ts: Date.now(),
      norm,
      matchesCount: matches.length,
      mcHandle: mcProfile.handle || null,
      operations: operations.map((op) => ({
        campaignId: op.campaignId,
        rule: op.rule,
        cardId: op.cardId,
        moveOk: op.move?.ok ?? false,
        skipReason: op.skipReason || null,
      })),
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
    mcProfile,
    operations,
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
