// web/app/api/mc/manychat/route.ts
// Ingest з ManyChat → live-пошук у KeyCRM (/pipelines/cards) → move card → лічильники у кампанії.
// Без KV-індексів для пошуку. KV використовується тільки для кампаній і лічильників.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';
import { Campaign } from '@/lib/types';
import { kcFindCardIdByAny, kcMoveCard } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

// локальна перевірка Bearer MC_TOKEN (щоб не залежати від lib/auth)
async function ensureMc(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.MC_TOKEN || '';
  if (!expected || token !== expected) {
    throw new Error('Unauthorized: invalid or missing MC_TOKEN');
  }
}

// KV keys для кампаній
const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

type IngestBody = {
  username?: string | null;   // IG username (може бути з @)
  text?: string | null;       // останній DM / last_input_text
  full_name?: string | null;  // повне ім'я
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  campaign_id?: string | null; // опційно: форснути конкретну кампанію
};

const norm = (s?: string | null) => String(s ?? '').trim();
const lower = (s?: string | null) => norm(s).toLowerCase();

function matchRule(op: 'contains'|'equals', value: string, hay: string) {
  const v = lower(value);
  const h = lower(hay);
  if (!v) return false;
  return op === 'equals' ? h === v : h.includes(v);
}

function ensureV2(c: Campaign): Campaign {
  if (!c.rules) (c as any).rules = { v1: { op: 'contains', value: '' }, v2: { op: 'contains', value: '' } };
  if (!c.rules.v2) (c as any).rules.v2 = { op: 'contains', value: '' };
  return c;
}

async function loadCampaigns(): Promise<Campaign[]> {
  const ids: string[] = await kvZRange(INDEX, 0, -1).catch(() => []);
  if (!ids?.length) return [];
  const ordered = [...ids].reverse(); // новіші перші
  const items: Campaign[] = [];
  for (const id of ordered) {
    const raw = await kvGet<any>(KEY(id)).catch(() => null);
    if (!raw) continue;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const c: Campaign = {
      ...obj,
      v1_count: Number(obj?.v1_count ?? 0),
      v2_count: Number(obj?.v2_count ?? 0),
      exp_count: Number(obj?.exp_count ?? 0),
    };
    items.push(ensureV2(c));
  }
  return items;
}

export async function POST(req: NextRequest) {
  try {
    await ensureMc(req);

    const body = (await req.json()) as IngestBody;
    const username = norm(body.username);
    const text = norm(body.text);
    const fullName =
      norm(body.full_name) ||
      norm(body.name) ||
      [norm(body.first_name), norm(body.last_name)].filter(Boolean).join(' ').trim();

    if (!username && !text && !fullName) {
      return NextResponse.json({ ok: false, error: 'missing username/text/full_name' }, { status: 400 });
    }

    const campaigns = await loadCampaigns();
    if (!campaigns.length) {
      return NextResponse.json({ ok: false, error: 'no campaigns configured' }, { status: 400 });
    }

    // якщо явно задано campaign_id — пробуємо її першою
    const explicit = body.campaign_id ? campaigns.find(c => c.id === body.campaign_id) : null;
    const ordered = explicit ? [explicit, ...campaigns.filter(c => c.id !== explicit.id)] : campaigns;

    // шукаємо першу активну кампанію, де тригериться V1 (і V2 — якщо задано)
    let chosen: Campaign | null = null;
    let v1Hit = false;
    let v2Hit = false;

    for (const c of ordered) {
      if (!c.active) continue;
      const v1val = c.rules?.v1?.value || '';
      const v1op = c.rules?.v1?.op || 'contains';
      const v2val = c.rules?.v2?.value || '';
      const v2op = c.rules?.v2?.op || 'contains';

      const hay = text || ''; // матчимо по тексту
      const v1ok = v1val ? matchRule(v1op as any, v1val, hay) : false;
      const v2ok = v2val ? matchRule(v2op as any, v2val, hay) : false;

      if (v1ok && (v2val ? v2ok : true)) {
        chosen = c;
        v1Hit = v1ok;
        v2Hit = v2ok;
        break;
      }
    }

    if (!chosen) {
      return NextResponse.json({
        ok: false,
        matched: false,
        reason: 'no campaign matched by V1/V2',
        used: { username, text, full_name: fullName },
      }, { status: 200 });
    }

    // live-пошук card_id напряму в KeyCRM в межах базової пари
    const cardId = await kcFindCardIdByAny({
      username,
      fullname: fullName,
      pipeline_id: chosen.base_pipeline_id,
      status_id: chosen.base_status_id,
      per_page: 50,
      max_pages: 2,
    });

    if (!cardId) {
      return NextResponse.json({
        ok: false,
        matched: true,
        campaign_id: chosen.id,
        found_card_id: null,
        reason: 'card not found in KeyCRM (pipelines/cards)',
        search_scope: {
          pipeline_id: chosen.base_pipeline_id,
          status_id: chosen.base_status_id,
        },
      }, { status: 200 });
    }

    // move у KeyCRM у базову пару (за потреби тут можна змінити ціль)
    const moveResp = await kcMoveCard({
      id: cardId,
      pipeline_id: chosen.base_pipeline_id,
      status_id: chosen.base_status_id,
    }).catch((e: any) => ({ ok: false, error: e?.message || String(e) }));

    // інкремент лічильників у самій кампанії
    const updated: Campaign = {
      ...chosen,
      v1_count: (chosen.v1_count ?? 0) + (v1Hit ? 1 : 0),
      v2_count: (chosen.v2_count ?? 0) + (v2Hit ? 1 : 0),
    };
    await kvSet(KEY(updated.id), updated);

    return NextResponse.json({
      ok: true,
      matched: true,
      campaign_id: chosen.id,
      counters: { v1_count: updated.v1_count, v2_count: updated.v2_count },
      action: 'move',
      keycrm: {
        moved: moveResp,
        card_id: cardId,
        to: { pipeline_id: chosen.base_pipeline_id, status_id: chosen.base_status_id },
      },
      used: { username, text, full_name: fullName },
    }, { status: 200 });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
