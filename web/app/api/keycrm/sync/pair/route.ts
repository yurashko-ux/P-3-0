// web/app/api/keycrm/sync/pair/route.ts
// Minimal webhook to route incoming MC/IG messages by active campaign rules and bump counters.
// Accepts:
//  - normalized: { title?: string, handle?: string, text?: string }
//  - ManyChat-ish: { event, data: { user: { username }, message: { text } } }  (best-effort extraction)
//
// Response: { ok, matched?: boolean, route?: 'v1'|'v2'|'none', campaign?: { id, name }, input: { title, handle, text } }

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import {
  collectRuleCandidates,
  chooseCampaignRoute,
  pickRuleCandidate,
  resolveRule,
  type CampaignLike,
} from '@/lib/campaign-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Campaign = CampaignLike & {
  id: string;
  name: string;
  active?: boolean;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ----- helpers -----

function normStr(s: unknown) {
  return (typeof s === 'string' ? s : '').trim();
}

function extractNormalized(body: any) {
  // already normalized?
  const title = normStr(body?.title);
  const handle = normStr(body?.handle);
  const text = normStr(body?.text);

  if (title || handle || text) {
    return { title, handle, text };
  }

  // ManyChat-ish best effort
  const mcText = normStr(body?.data?.message?.text) || normStr(body?.message?.text);
  const mcHandle = normStr(body?.data?.user?.username) || normStr(body?.user?.username);
  return { title: '', handle: mcHandle, text: mcText };
}

async function bumpCounter(id: string, field: 'v1_count' | 'v2_count' | 'exp_count') {
  const itemKey = campaignKeys.ITEM_KEY(id);
  const raw = await kvRead.getRaw(itemKey);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    obj[field] = (typeof obj[field] === 'number' ? obj[field] : 0) + 1;
    await kvWrite.setRaw(itemKey, JSON.stringify(obj));
    // необов’язково: кладемо id в head, щоб кампанія піднімалась у списку
    try { await kvWrite.lpush(campaignKeys.INDEX_KEY, id); } catch {}
  } catch {}
}

// ----- route handler -----

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const norm = extractNormalized(body);

    // 1) беремо всі кампанії та фільтруємо активні
    let campaigns: Campaign[] = [];
    try {
      campaigns = await kvRead.listCampaigns() as any;
    } catch {
      campaigns = [];
    }
    const active = campaigns.filter(c => c?.active !== false);

    // 2) спроба знайти першу, що матчить
    let chosen: { route: 'v1'|'v2'|'none', campaign?: Campaign } = { route: 'none' };
    const { values: candidates, truncated } = collectRuleCandidates(
      body,
      [norm.text, norm.title, norm.handle],
      { limit: 25 },
    );
    for (const c of active) {
      const route = chooseCampaignRoute(candidates, c);
      if (route !== 'none') {
        chosen = { route, campaign: c };
        break;
      }
    }

    const resolvedV1 = chosen.campaign ? resolveRule(pickRuleCandidate(chosen.campaign, 'v1')) : null;
    const resolvedV2 = chosen.campaign ? resolveRule(pickRuleCandidate(chosen.campaign, 'v2')) : null;

    // 3) якщо знайшли — інкрементуємо лічильник
    if (chosen.campaign && chosen.route !== 'none') {
      await bumpCounter(chosen.campaign.id, chosen.route === 'v1' ? 'v1_count' : 'v2_count');
    }

    // TODO (next step): тут же викликати KeyCRM API для створення/руху картки
    return NextResponse.json({
      ok: true,
      matched: chosen.route !== 'none',
      route: chosen.route,
      campaign: chosen.campaign ? { id: chosen.campaign.id, name: chosen.campaign.name } : undefined,
      input: norm,
      debug: {
        candidates: candidates.slice(0, 25),
        candidateCount: candidates.length,
        truncated,
        ruleV1: resolvedV1 ? { value: resolvedV1.value, op: resolvedV1.op } : null,
        ruleV2: resolvedV2 ? { value: resolvedV2.value, op: resolvedV2.op } : null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}
