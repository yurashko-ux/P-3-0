// web/app/api/mc/manychat/route.ts
// ManyChat webhook handler (IG). Migrated to kvRead/kvWrite + LIST index.
// Keeps behavior minimal: normalize payload, read active campaigns, compute rule matches,
// and return a diagnostic response (routing to KeyCRM is done by /api/keycrm/sync/pair).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

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

export async function POST(req: NextRequest) {
  // Optional verification of ManyChat secret if you use it:
  const mcToken = process.env.MC_TOKEN;
  const headerToken =
    req.headers.get('x-mc-token') ||
    req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '') ||
    '';
  const queryToken = req.nextUrl?.searchParams.get('token') || '';
  if (
    mcToken &&
    !(headerToken === mcToken || queryToken === mcToken)
  ) {
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
  const text = norm.text || '';
  const matches = active.map((c) => {
    const v1 = matchRule(text, c.rules?.v1);
    const v2 = matchRule(text, c.rules?.v2);
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
