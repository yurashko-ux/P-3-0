// web/app/api/keycrm/sync/pair/route.ts
// Minimal webhook to route incoming MC/IG messages by active campaign rules and bump counters.
// Accepts:
//  - normalized: { title?: string, handle?: string, text?: string }
//  - ManyChat-ish: { event, data: { user: { username }, message: { text } } }  (best-effort extraction)
//
// Response: { ok, matched?: boolean, route?: 'v1'|'v2'|'none', campaign?: { id, name }, target?: { pipeline, status, source }, input: { title, handle, text } }

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VariantRule = {
  op: 'contains' | 'equals';
  value: string;
  pipeline_id?: string | number | null;
  status_id?: string | number | null;
  pipeline?: string | number | null;
  status?: string | number | null;
};

type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  rules?: { v1?: VariantRule; v2?: VariantRule };
  v1_to_pipeline_id?: string | number | null;
  v1_to_status_id?: string | number | null;
  v2_to_pipeline_id?: string | number | null;
  v2_to_status_id?: string | number | null;
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

function matchRule(text: string, rule?: VariantRule): boolean {
  if (!rule || !rule.value) return false;
  const needle = rule.value.toLowerCase();
  const hay = (text || '').toLowerCase();
  if (rule.op === 'equals') return hay === needle;
  // default contains
  return hay.includes(needle);
}

function chooseRoute(text: string, rules?: { v1?: VariantRule; v2?: VariantRule }): 'v1' | 'v2' | 'none' {
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

function normId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (lower === 'null' || lower === 'undefined') return '';
    return trimmed;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown> | null;
    if (!obj) return '';
    const cand =
      ('value' in obj ? obj.value : undefined) ??
      ('id' in obj ? obj.id : undefined) ??
      ('pipeline_id' in obj ? obj.pipeline_id : undefined) ??
      ('status_id' in obj ? obj.status_id : undefined);
    if (cand != null) return normId(cand);
    return '';
  }
  return normId(String(value));
}

function pickId(...values: Array<unknown>): string {
  for (const v of values) {
    const normalized = normId(v);
    if (normalized) return normalized;
  }
  return '';
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

    let target: { pipeline: string; status: string; source: 'top' | 'fallback' | 'mixed' } | null = null;
    if (chosen.campaign && chosen.route !== 'none') {
      const variant = chosen.route;
      const topPipeline = variant === 'v1'
        ? pickId(chosen.campaign.v1_to_pipeline_id)
        : pickId(chosen.campaign.v2_to_pipeline_id);
      const topStatus = variant === 'v1'
        ? pickId(chosen.campaign.v1_to_status_id)
        : pickId(chosen.campaign.v2_to_status_id);

      const rule = variant === 'v1' ? chosen.campaign.rules?.v1 : chosen.campaign.rules?.v2;
      const fallbackPipeline = pickId(rule?.pipeline_id, rule?.pipeline);
      const fallbackStatus = pickId(rule?.status_id, rule?.status);

      const pipeline = topPipeline || fallbackPipeline;
      const status = topStatus || fallbackStatus;

      if (pipeline && status) {
        const source = topPipeline && topStatus
          ? 'top'
          : (!topPipeline && !topStatus && pipeline === fallbackPipeline && status === fallbackStatus)
            ? 'fallback'
            : 'mixed';
        target = { pipeline, status, source };

        if (source !== 'top') {
          console.info('[pair] target resolved via rules fallback', {
            campaignId: chosen.campaign.id,
            route: variant,
            pipeline,
            status,
            source,
          });
        }
      } else {
        console.warn('[pair] missing target ids', {
          campaignId: chosen.campaign.id,
          route: variant,
          top: { pipeline: topPipeline, status: topStatus },
          fallback: { pipeline: fallbackPipeline, status: fallbackStatus },
        });
      }
    }

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
      target: target ?? undefined,
      input: norm,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}
