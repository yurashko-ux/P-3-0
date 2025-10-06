// web/app/api/keycrm/sync/pair/route.ts
// Webhook, що об'єднує логіку ManyChat → KeyCRM:
//  • нормалізує payload і знаходить кампанію за правилами V1/V2
//  • шукає картку у базовій воронці кампанії (pipeline+status)
//  • рухає знайдену картку у цільовий статус, визначений правилом
//
// Повертає діагностичний JSON із даними пошуку/руху та вхідним payload.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { readJsonSafe, normalizeManychatPayload } from '@/lib/mc';
import { kcFindCardIdInScope, kcMoveCard } from '@/lib/keycrm-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string; pipeline_id?: number; status_id?: number };
type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  enabled?: boolean;
  rules?: { v1?: Rule; v2?: Rule };
  base_pipeline_id?: number | string | null;
  base_status_id?: number | string | null;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ----- helpers -----

function normStr(s: unknown) {
  return (typeof s === 'string' ? s : '').trim();
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

function parseNumber(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function collectFullNames(raw?: string): string[] {
  const names = new Set<string>();
  const base = normStr(raw);
  if (!base) return [];
  names.add(base);
  // варіант без подвійних пробілів
  const collapsed = base.replace(/\s+/g, ' ').trim();
  if (collapsed && !names.has(collapsed)) names.add(collapsed);
  return Array.from(names);
}

// ----- route handler -----

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonSafe(req as any);
    const mc = normalizeManychatPayload(body);
    const handle = mc.username || normStr(body?.handle) || normStr(body?.subscriber?.username);
    const text = mc.text || normStr(body?.text) || normStr(body?.message?.text);
    const fullName = mc.fullName || normStr(body?.fullName) || normStr(body?.contact?.full_name);
    const norm = {
      title: (typeof body?.title === 'string' && body.title.trim()) || '',
      handle,
      text,
      fullName,
    };

    // 1) беремо всі кампанії та фільтруємо активні
    let campaigns: Campaign[] = [];
    try {
      campaigns = await kvRead.listCampaigns() as any;
    } catch {
      campaigns = [];
    }
    const active = campaigns.filter((c) => c?.active !== false && c?.enabled !== false);

    // 2) спроба знайти першу, що матчить
    let chosen: { route: 'v1'|'v2'|'none', campaign?: Campaign, rule?: Rule } = { route: 'none' };
    for (const c of active) {
      const route = chooseRoute(norm.text, c.rules);
      if (route !== 'none') {
        const rule = route === 'v1' ? c.rules?.v1 : c.rules?.v2;
        chosen = { route, campaign: c, rule: rule ?? undefined };
        break;
      }
    }

    // 3) якщо знайшли — інкрементуємо лічильник
    if (chosen.campaign && chosen.route !== 'none') {
      await bumpCounter(chosen.campaign.id, chosen.route === 'v1' ? 'v1_count' : 'v2_count');
    }

    let search: Awaited<ReturnType<typeof kcFindCardIdInScope>> | null = null;
    let moveResult: Awaited<ReturnType<typeof kcMoveCard>> | null = null;

    if (chosen.campaign && chosen.route !== 'none') {
      const basePipeline = parseNumber(chosen.campaign.base_pipeline_id);
      const baseStatus = parseNumber(chosen.campaign.base_status_id);

      if (basePipeline == null || baseStatus == null) {
        return NextResponse.json({
          ok: false,
          error: 'campaign_missing_base_scope',
          campaign: { id: chosen.campaign.id, name: chosen.campaign.name },
          input: norm,
        }, { status: 422 });
      }

      const fullNames = collectFullNames(fullName);

      search = await kcFindCardIdInScope({
        username: handle,
        fullNames,
        pipeline_id: basePipeline,
        status_id: baseStatus,
      });

      const cardId = search.cardId;
      if (cardId && chosen.rule) {
        const targetPipeline = parseNumber(chosen.rule.pipeline_id);
        const targetStatus = parseNumber(chosen.rule.status_id);

        if (targetPipeline == null || targetStatus == null) {
          return NextResponse.json({
            ok: false,
            error: 'campaign_missing_target',
            campaign: { id: chosen.campaign.id, name: chosen.campaign.name },
            route: chosen.route,
            search,
            input: norm,
          }, { status: 422 });
        }

        moveResult = await kcMoveCard(cardId, targetPipeline, targetStatus);
      }
    }

    return NextResponse.json({
      ok: true,
      matched: chosen.route !== 'none',
      route: chosen.route,
      campaign: chosen.campaign ? { id: chosen.campaign.id, name: chosen.campaign.name } : undefined,
      search,
      move: moveResult,
      input: norm,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}
