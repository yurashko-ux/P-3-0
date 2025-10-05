// web/app/api/keycrm/sync/pair/route.ts
// Minimal webhook to route incoming MC/IG messages by active campaign rules and bump counters.
// Accepts:
//  - normalized: { title?: string, handle?: string, text?: string }
//  - ManyChat-ish: { event, data: { user: { username }, message: { text } } }  (best-effort extraction)
//
// Response: { ok, matched?: boolean, route?: 'v1'|'v2'|'none', campaign?: { id, name }, input: { title, handle, text } }

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { findCardSimple } from '@/lib/keycrm-find';
import { keycrmMoveCard, type KeycrmMoveResult } from '@/lib/keycrm-move';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MaybeId = string | number | null | undefined;

type Rule = {
  op: 'contains' | 'equals';
  value: string;
  pipeline_id?: MaybeId;
  status_id?: MaybeId;
  to_pipeline_id?: MaybeId;
  to_status_id?: MaybeId;
  pipeline?: MaybeId;
  status?: MaybeId;
};
type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  base_pipeline_id?: MaybeId;
  base_status_id?: MaybeId;
  rules?: { v1?: Rule; v2?: Rule };
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

function matchRule(text: string, rule?: Rule): boolean {
  if (!rule || !rule.value) return false;
  const needle = rule.value.toLowerCase();
  const hay = (text || '').toLowerCase();
  if (rule.op === 'equals') return hay === needle;
  // default contains
  return hay.includes(needle);
}

function chooseRoute(text: string, rules?: { v1?: Rule; v2?: Rule }): 'v1' | 'v2' | 'none' {
  const r1 = matchRule(text, rules?.v1);
  const r2 = matchRule(text, rules?.v2);
  if (r1 && !r2) return 'v1';
  if (r2 && !r1) return 'v2';
  // якщо збігаються обидва або жоден — не вирішуємо (можна додати пріоритети пізніше)
  if (r1 && r2) return 'v1'; // простий пріоритет v1, щоб не губити подію
  return 'none';
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

const toIdString = (value: MaybeId): string | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str : null;
};

const toIdNumber = (value: MaybeId): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const getTargetForRule = (rule?: Rule) => ({
  pipeline: toIdString(rule?.pipeline_id ?? rule?.to_pipeline_id ?? rule?.pipeline),
  status: toIdString(rule?.status_id ?? rule?.to_status_id ?? rule?.status),
});

const guessFullName = (title: string | undefined) => {
  const raw = (title || '').trim();
  if (!raw) return '';
  if (/^ig message$/i.test(raw)) return '';
  const match = raw.match(/^(?:чат\s+з|chat\s+with)\s+(.+)/i);
  return (match ? match[1] : raw).trim();
};

function isAuthorized(req: NextRequest) {
  const token = process.env.MC_TOKEN;
  if (!token) return true;
  const header = req.headers
    .get('x-mc-token')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || req.nextUrl.searchParams.get('token')
    || '';
  return header === token;
}

// ----- route handler -----

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const norm = extractNormalized(body);

    if (!norm.handle) {
      return NextResponse.json({ ok: false, error: 'missing_handle', input: norm }, { status: 400 });
    }

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
    for (const c of active) {
      const route = chooseRoute(norm.text, c.rules);
      if (route !== 'none') {
        chosen = { route, campaign: c };
        break;
      }
    }

    if (!chosen.campaign || chosen.route === 'none') {
      return NextResponse.json({
        ok: true,
        matched: false,
        route: 'none',
        campaign: undefined,
        input: norm,
      });
    }

    const campaignInfo = { id: chosen.campaign.id, name: chosen.campaign.name };
    const basePipeline = toIdNumber(chosen.campaign.base_pipeline_id);
    const baseStatus = toIdNumber(chosen.campaign.base_status_id);

    if (basePipeline === undefined || baseStatus === undefined) {
      return NextResponse.json({
        ok: false,
        error: 'campaign_base_missing',
        campaign: campaignInfo,
        route: chosen.route,
        input: norm,
      }, { status: 500 });
    }

    const rule = chosen.route === 'v1' ? chosen.campaign.rules?.v1 : chosen.campaign.rules?.v2;
    const target = getTargetForRule(rule);

    if (!target.pipeline || !target.status) {
      return NextResponse.json({
        ok: false,
        error: 'campaign_target_missing',
        campaign: campaignInfo,
        route: chosen.route,
        input: norm,
      }, { status: 500 });
    }

    const find = await findCardSimple({
      username: norm.handle,
      full_name: guessFullName(norm.title),
      social_name: 'instagram',
      pipeline_id: basePipeline,
      status_id: baseStatus,
      scope: 'campaign',
    });

    if (!find.ok) {
      return NextResponse.json({
        ok: false,
        error: find.error || 'find_failed',
        campaign: campaignInfo,
        route: chosen.route,
        input: norm,
        lookup: find,
      }, { status: 502 });
    }

    const cardId = find.result?.id ? String(find.result.id) : null;

    if (!cardId) {
      return NextResponse.json({
        ok: true,
        matched: true,
        route: chosen.route,
        campaign: campaignInfo,
        input: norm,
        lookup: find,
        move: { ok: false, error: 'card_not_found' },
      });
    }

    const move = await keycrmMoveCard({
      card_id: cardId,
      pipeline_id: target.pipeline,
      status_id: target.status,
    });

    if (!move.ok) {
      const failure = move as Extract<KeycrmMoveResult, { ok: false }>;
      return NextResponse.json({
        ok: false,
        error: failure.error,
        campaign: campaignInfo,
        route: chosen.route,
        input: norm,
        lookup: find,
        move: failure,
      }, { status: 502 });
    }

    await bumpCounter(chosen.campaign.id, chosen.route === 'v1' ? 'v1_count' : 'v2_count');

    return NextResponse.json({
      ok: true,
      matched: true,
      route: chosen.route,
      campaign: campaignInfo,
      input: norm,
      card_id: cardId,
      move: { ok: true, via: move.via, status: move.status, response: move.response },
      lookup: { ok: true, result: find.result, stats: find.stats },
      counterBumped: true,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}
