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
import { assertKeycrmEnv, keycrmHeaders, keycrmUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type RuleWithTarget = Rule & {
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
  pipeline?: string | number | null;
  status?: string | number | null;
};
type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  base_pipeline_id?: string | number | null;
  base_status_id?: string | number | null;
  base?: { pipeline?: string | number | null; status?: string | number | null } | null;
  rules?: { v1?: RuleWithTarget | null; v2?: RuleWithTarget | null };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

type AutoMoveResult = {
  attempted: boolean;
  ok: boolean;
  reason?: string;
  cardId?: string;
  target?: { pipeline_id: string; status_id: string; route: 'v1' | 'v2' };
  lookup?: any;
  move?: any;
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

function normalizeId(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function extractBaseIds(c: Campaign): { pipeline: string; status: string } | null {
  const pipeline =
    normalizeId((c.base && c.base.pipeline) ?? c.base_pipeline_id) ??
    normalizeId((c as any)?.base_pipeline);
  const status =
    normalizeId((c.base && c.base.status) ?? c.base_status_id) ??
    normalizeId((c as any)?.base_status);
  if (!pipeline || !status) return null;
  return { pipeline, status };
}

function extractRuleTarget(rule?: RuleWithTarget | null): { pipeline: string; status: string } | null {
  if (!rule) return null;
  const pipeline =
    normalizeId(rule.pipeline_id ?? (rule as any)?.target_pipeline_id ?? rule.pipeline) ?? null;
  const status =
    normalizeId(rule.status_id ?? (rule as any)?.target_status_id ?? rule.status) ?? null;
  if (!pipeline || !status) return null;
  return { pipeline, status };
}

function cleanHandle(handle: string | undefined | null) {
  if (!handle) return '';
  return handle.trim().replace(/^@+/, '');
}

async function lookupCard(
  campaign: Campaign,
  norm: { handle: string; title: string }
): Promise<{ ok: boolean; cardId?: string; detail?: any; skipped?: boolean; reason?: string }> {
  const base = extractBaseIds(campaign);
  if (!base) {
    return { ok: false, skipped: true, reason: 'base_missing' };
  }

  const username = cleanHandle(norm.handle);
  const fullName = norm.title?.trim() || '';
  if (!username && !fullName) {
    return { ok: false, skipped: true, reason: 'identifier_missing' };
  }

  const pipelineNum = Number(base.pipeline);
  const statusNum = Number(base.status);
  if (!Number.isFinite(pipelineNum) || !Number.isFinite(statusNum)) {
    return { ok: false, skipped: true, reason: 'base_invalid' };
  }
  const res = await findCardSimple({
    username: username || undefined,
    full_name: fullName || undefined,
    pipeline_id: pipelineNum,
    status_id: statusNum,
    scope: 'campaign',
    strategy: username ? 'social' : 'both',
    max_pages: 3,
  });

  if (!res?.ok || !res.result?.id) {
    return { ok: false, cardId: undefined, detail: res };
  }

  return { ok: true, cardId: String(res.result.id), detail: res };
}

async function moveCardDirect(cardId: string, pipeline: string, status: string) {
  try {
    assertKeycrmEnv();
  } catch (err: any) {
    return {
      ok: false,
      reason: 'keycrm_env_missing',
      message: err?.message || String(err),
    };
  }

  const attempts = [
    {
      name: 'cards/{id}/move',
      url: keycrmUrl(`/cards/${encodeURIComponent(cardId)}/move`),
      body: { pipeline_id: pipeline, status_id: status },
    },
    {
      name: 'pipelines/cards/move',
      url: keycrmUrl('/pipelines/cards/move'),
      body: { card_id: cardId, pipeline_id: pipeline, status_id: status },
    },
  ];

  const headers = keycrmHeaders();
  let lastError: any = null;
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(attempt.body),
        cache: 'no-store',
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (res.ok && (json == null || json.ok === undefined || json.ok === true)) {
        return { ok: true, via: attempt.name, status: res.status, response: json ?? text };
      }
      lastError = {
        ok: false,
        reason: 'move_failed',
        attempt: attempt.name,
        status: res.status,
        response: json ?? text,
      };
    } catch (err: any) {
      lastError = {
        ok: false,
        reason: 'move_exception',
        attempt: attempt.name,
        message: err?.message || String(err),
      };
    }
  }

  return lastError ?? { ok: false, reason: 'move_not_attempted' };
}

async function autoMoveCard(
  campaign: Campaign,
  route: 'v1' | 'v2',
  norm: { handle: string; title: string }
): Promise<AutoMoveResult> {
  const targetRule = route === 'v1' ? campaign.rules?.v1 : campaign.rules?.v2;
  const target = extractRuleTarget(targetRule ?? undefined);
  if (!target) {
    return { attempted: false, ok: false, reason: 'target_missing' };
  }

  const lookup = await lookupCard(campaign, norm);
  if (!lookup.ok || !lookup.cardId) {
    return {
      attempted: !lookup.skipped,
      ok: false,
      reason: lookup.reason || 'card_not_found',
      lookup: lookup.detail,
    };
  }

  const move = await moveCardDirect(lookup.cardId, target.pipeline, target.status);
  return {
    attempted: true,
    ok: Boolean(move?.ok),
    cardId: lookup.cardId,
    target: { pipeline_id: target.pipeline, status_id: target.status, route },
    lookup: lookup.detail,
    move,
  };
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
    for (const c of active) {
      const route = chooseRoute(norm.text, c.rules);
      if (route !== 'none') {
        chosen = { route, campaign: c };
        break;
      }
    }

    // 3) якщо знайшли — інкрементуємо лічильник
    let moveResult: AutoMoveResult | null = null;
    if (chosen.campaign && chosen.route !== 'none') {
      await bumpCounter(chosen.campaign.id, chosen.route === 'v1' ? 'v1_count' : 'v2_count');
      try {
        moveResult = await autoMoveCard(chosen.campaign, chosen.route, norm);
      } catch (err: any) {
        moveResult = {
          attempted: false,
          ok: false,
          reason: 'auto_move_exception',
          move: { message: err?.message || String(err) },
        };
      }
    }

    return NextResponse.json({
      ok: true,
      matched: chosen.route !== 'none',
      route: chosen.route,
      campaign: chosen.campaign ? { id: chosen.campaign.id, name: chosen.campaign.name } : undefined,
      input: norm,
      move: moveResult,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}
