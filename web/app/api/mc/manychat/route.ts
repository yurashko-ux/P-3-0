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
  enabled?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  base?: { pipeline?: string | number | null; status?: string | number | null };
  rules?: { v1?: Rule; v2?: Rule };
  exp?: Record<string, unknown>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
  v1_to_pipeline_id?: string | number | null;
  v1_to_status_id?: string | number | null;
  v2_to_pipeline_id?: string | number | null;
  v2_to_status_id?: string | number | null;
  t1?: { pipeline?: string | number | null; status?: string | number | null };
  t2?: { pipeline?: string | number | null; status?: string | number | null };
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

const toNumberSafe = (value: any): number | null => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toStringSafe = (value: any): string | null => {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str : null;
};

const normalizeUsername = (raw: string): string => raw.replace(/^@+/, '').trim();

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
  const active = campaigns.filter((c) => (c?.active ?? true) !== false && (c?.enabled ?? true) !== false);

  // Compute matches and determine first triggered campaign
  const text = norm.text || '';
  const matches: Array<{ id: string; name: string; v1: boolean; v2: boolean }> = [];
  let triggered: { campaign: Campaign; route: 'v1' | 'v2' } | null = null;
  for (const c of active) {
    const v1 = matchRule(text, c.rules?.v1);
    const v2 = matchRule(text, c.rules?.v2);
    if (v1 || v2) {
      matches.push({ id: c.id, name: c.name, v1, v2 });
      if (!triggered) {
        triggered = { campaign: c, route: v2 ? 'v2' : 'v1' };
      }
    }
  }

  // KeyCRM lookup/move result snapshot (attached to response + log)
  const keycrm: {
    attempted?: boolean;
    lookup?: {
      ok: boolean;
      error?: string;
      result?: { id: string; pipeline_id: number | null; status_id: number | null } | null;
    };
    move?: { ok: boolean; status?: number; via?: string | null; error?: string };
    skippedReason?: string;
    error?: string;
  } = {};

  if (triggered) {
    keycrm.attempted = true;

    const campaign = triggered.campaign;
    const handleRaw = norm.handle ||
      payload?.subscriber?.username ||
      payload?.user?.username ||
      payload?.data?.user?.username ||
      '';
    const username = normalizeUsername(handleRaw || '');

    const basePipeline = toNumberSafe(campaign.base_pipeline_id ?? campaign.base?.pipeline);
    const baseStatus = toNumberSafe(campaign.base_status_id ?? campaign.base?.status);

    if (!username) {
      keycrm.skippedReason = 'missing_username';
    } else if (basePipeline == null || baseStatus == null) {
      keycrm.skippedReason = 'missing_base_scope';
    } else {
      try {
        const lookup = await findCardSimple({
          username,
          social_name: 'instagram',
          scope: 'campaign',
          pipeline_id: basePipeline,
          status_id: baseStatus,
        });

        keycrm.lookup = {
          ok: !!lookup?.ok,
          error: (lookup as any)?.error,
          result: lookup?.result
            ? {
                id: String(lookup.result.id),
                pipeline_id: toNumberSafe(lookup.result.pipeline_id),
                status_id: toNumberSafe(lookup.result.status_id),
              }
            : null,
        };

        const cardId = lookup?.result?.id ? String(lookup.result.id) : null;
        if (!cardId) {
          keycrm.skippedReason = keycrm.skippedReason || 'card_not_found';
        } else {
          const toPipelineRaw =
            triggered.route === 'v2'
              ? campaign.v2_to_pipeline_id ?? campaign.t2?.pipeline
              : campaign.v1_to_pipeline_id ?? campaign.t1?.pipeline;
          const toStatusRaw =
            triggered.route === 'v2'
              ? campaign.v2_to_status_id ?? campaign.t2?.status
              : campaign.v1_to_status_id ?? campaign.t1?.status;

          const toPipeline = toStringSafe(toPipelineRaw);
          const toStatus = toStringSafe(toStatusRaw);

          if (!toPipeline || !toStatus) {
            keycrm.skippedReason = 'missing_target';
          } else {
            try {
              const moveUrl = new URL('/api/keycrm/card/move', req.url);
              const moveRes = await fetch(moveUrl.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  card_id: cardId,
                  to_pipeline_id: toPipeline,
                  to_status_id: toStatus,
                }),
                cache: 'no-store',
              });
              const moveJson: any = await moveRes.json().catch(() => ({}));
              keycrm.move = {
                ok: moveRes.ok && moveJson?.ok !== false,
                status: moveRes.status,
                via: moveJson?.via ?? null,
                error: moveJson?.error,
              };
            } catch (err: any) {
              keycrm.error = `move_failed: ${String(err?.message || err)}`;
            }
          }
        }
      } catch (err: any) {
        keycrm.error = `lookup_failed: ${String(err?.message || err)}`;
      }
    }
  }

  // (Optional) very light logging to help with diagnostics:
  try {
    const logKey = `logs:mc:${new Date().toISOString().slice(0, 10)}`; // per-day key
    const record = JSON.stringify({
      ts: Date.now(),
      norm,
      matchesCount: matches.length,
      triggered: triggered ? { id: triggered.campaign.id, route: triggered.route } : null,
      keycrm: keycrm.attempted
        ? {
            lookupOk: keycrm.lookup?.ok ?? false,
            cardId: keycrm.lookup?.result?.id ?? null,
            moveOk: keycrm.move?.ok ?? false,
            skippedReason: keycrm.skippedReason ?? null,
            error: keycrm.error ?? null,
          }
        : undefined,
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
    triggered: triggered ? { id: triggered.campaign.id, name: triggered.campaign.name, route: triggered.route } : null,
    keycrm,
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
