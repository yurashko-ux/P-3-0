// web/app/api/mc/manychat/route.ts
// ManyChat webhook handler (IG). Migrated to kvRead/kvWrite + LIST index.
// Keeps behavior minimal: normalize payload, read active campaigns, compute rule matches,
// and return a diagnostic response (routing to KeyCRM is done by /api/keycrm/sync/pair).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import {
  normalizeCandidate,
  matchRuleAgainstInputs,
  pickRuleCandidate,
  type CampaignLike,
} from '@/lib/campaign-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Campaign = CampaignLike & {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
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

function collectCandidates(
  value: unknown,
  seen: Set<string>,
  depth = 12,
  visited?: WeakSet<object>,
) {
  if (depth <= 0 || value == null) return;

  if (typeof value === 'string') {
    const normalized = normalizeCandidate(value).trim();
    if (normalized) seen.add(normalized);
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    seen.add(String(value));
    return;
  }

  const nextVisited = visited ?? new WeakSet<object>();

  if (Array.isArray(value)) {
    if (nextVisited.has(value as object)) return;
    nextVisited.add(value as object);
    for (const item of value) {
      collectCandidates(item, seen, depth - 1, nextVisited);
    }
    return;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (nextVisited.has(obj)) return;
    nextVisited.add(obj);
    for (const v of Object.values(obj)) {
      collectCandidates(v, seen, depth - 1, nextVisited);
    }
  }
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

  // Compute matches
  const candidates = new Set<string>();
  collectCandidates(payload, candidates);
  const push = (value: unknown) => {
    const normalized = normalizeCandidate(value).trim();
    if (normalized) candidates.add(normalized);
  };
  push(norm.text);
  push(norm.title);
  push(norm.handle);

  const textCandidates = Array.from(candidates);

  const matches = active.map((c) => {
    const v1 = matchRuleAgainstInputs(textCandidates, pickRuleCandidate(c, 'v1'));
    const v2 = matchRuleAgainstInputs(textCandidates, pickRuleCandidate(c, 'v2'));
    return { id: c.id, name: c.name, v1, v2 };
  }).filter(m => m.v1 || m.v2);

  // (Optional) very light logging to help with diagnostics:
  try {
    const logKey = `logs:mc:${new Date().toISOString().slice(0, 10)}`; // per-day key
    const record = JSON.stringify({ ts: Date.now(), norm, matchesCount: matches.length });
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
