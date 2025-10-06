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
import { moveCard } from '@/lib/keycrm-move';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  rules?: { v1?: Rule; v2?: Rule };
  base_pipeline_id?: number | string | null;
  base_status_id?: number | string | null;
  v1_to_pipeline_id?: number | string | null;
  v1_to_status_id?: number | string | null;
  v2_to_pipeline_id?: number | string | null;
  v2_to_status_id?: number | string | null;
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

    let cardSummary: { id: string; pipeline_id?: number | null; status_id?: number | null } | null = null;
    let findSummary:
      | {
          ok: boolean;
          error?: string;
          hint?: string;
          used?: any;
          stats?: any;
          result?: any;
        }
      | undefined;
    let moveSummary:
      | {
          ok: boolean;
          via?: string;
          status?: number;
          error?: string;
        }
      | null = null;
    let message: string | undefined;

    if (chosen.campaign && chosen.route !== 'none') {
      const basePipelineRaw = chosen.campaign.base_pipeline_id;
      const baseStatusRaw = chosen.campaign.base_status_id;
      const basePipeline =
        basePipelineRaw != null && basePipelineRaw !== ''
          ? Number(basePipelineRaw)
          : Number.NaN;
      const baseStatus =
        baseStatusRaw != null && baseStatusRaw !== ''
          ? Number(baseStatusRaw)
          : Number.NaN;

      if (!Number.isFinite(basePipeline) || !Number.isFinite(baseStatus)) {
        message = 'Кампанія не має базової воронки або статусу для пошуку картки.';
        console.error('[keycrm/pair] missing base pipeline/status', {
          campaignId: chosen.campaign.id,
          base_pipeline_id: chosen.campaign.base_pipeline_id,
          base_status_id: chosen.campaign.base_status_id,
        });
      } else {
        const findRes = await findCardSimple({
          username: norm.handle || undefined,
          full_name: norm.title || undefined,
          pipeline_id: basePipeline,
          status_id: baseStatus,
          scope: 'campaign',
          social_name: norm.handle ? 'instagram' : undefined,
        });

        if (!findRes.ok) {
          findSummary = {
            ok: false,
            error: findRes.error,
            hint: findRes.hint,
            used: findRes.used,
          };
          message = 'Не вдалося знайти картку в KeyCRM. Повідомте менеджеру.';
          console.error('[keycrm/pair] find error', {
            campaignId: chosen.campaign.id,
            handle: norm.handle,
            title: norm.title,
            error: findRes.error,
            hint: findRes.hint,
            used: findRes.used,
          });
        } else if (!findRes.result) {
          findSummary = {
            ok: true,
            result: null,
            stats: findRes.stats,
            used: findRes.used,
          };
          message = 'Картку з таким Instagram профілем не знайдено у базовій воронці.';
          console.warn('[keycrm/pair] card not found', {
            campaignId: chosen.campaign.id,
            handle: norm.handle,
            title: norm.title,
            stats: findRes.stats,
            used: findRes.used,
          });
        } else {
          findSummary = {
            ok: true,
            result: { id: findRes.result.id },
            stats: findRes.stats,
            used: findRes.used,
          };
          cardSummary = {
            id: String(findRes.result.id),
            pipeline_id: findRes.result.pipeline_id ?? null,
            status_id: findRes.result.status_id ?? null,
          };

          const target =
            chosen.route === 'v1'
              ? {
                  pipeline: chosen.campaign.v1_to_pipeline_id,
                  status: chosen.campaign.v1_to_status_id,
                }
              : {
                  pipeline: chosen.campaign.v2_to_pipeline_id,
                  status: chosen.campaign.v2_to_status_id,
                };

          const to_pipeline_id =
            target.pipeline != null && target.pipeline !== ''
              ? String(target.pipeline)
              : null;
          const to_status_id =
            target.status != null && target.status !== ''
              ? String(target.status)
              : null;

          if (!to_pipeline_id || !to_status_id) {
            message = 'Не налаштовано цільову воронку або статус для цього варіанту кампанії.';
            console.error('[keycrm/pair] missing target pipeline/status', {
              campaignId: chosen.campaign.id,
              variant: chosen.route,
              to_pipeline_id: chosen.route === 'v1'
                ? chosen.campaign.v1_to_pipeline_id
                : chosen.campaign.v2_to_pipeline_id,
              to_status_id: chosen.route === 'v1'
                ? chosen.campaign.v1_to_status_id
                : chosen.campaign.v2_to_status_id,
            });
          } else {
            const moveRes = await moveCard({
              card_id: cardSummary.id,
              to_pipeline_id,
              to_status_id,
            });

            if (!moveRes.ok) {
              moveSummary = {
                ok: false,
                via: moveRes.attempt,
                status: moveRes.status,
                error: moveRes.error || 'keycrm_move_failed',
              };
              message = 'Не вдалося перемістити картку в KeyCRM. Спробуйте пізніше або зверніться до менеджера.';
              console.error('[keycrm/pair] move failed', {
                campaignId: chosen.campaign.id,
                card_id: cardSummary.id,
                attempt: moveRes.attempt,
                status: moveRes.status,
                text: moveRes.text,
                json: moveRes.json,
                need: moveRes.need,
              });
            } else {
              moveSummary = {
                ok: true,
                via: moveRes.attempt,
                status: moveRes.status,
              };
              await bumpCounter(
                chosen.campaign.id,
                chosen.route === 'v1' ? 'v1_count' : 'v2_count'
              );
            }
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      matched: chosen.route !== 'none',
      route: chosen.route,
      campaign: chosen.campaign ? { id: chosen.campaign.id, name: chosen.campaign.name } : undefined,
      input: norm,
      card: cardSummary,
      find: findSummary,
      move: moveSummary,
      message,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}
