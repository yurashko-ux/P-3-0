// web/app/api/mc/ingest/route.ts
import { NextResponse } from 'next/server';
import { kcFindCardIdByAny, kcMoveCard, kcGetCardState } from '@/lib/keycrm';
import { kvGet, kvZRange, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

function s(v: any, d = ''): string {
  return v == null ? d : String(v).trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // Нормалізація ManyChat полів
    const username =
      s(body.username) ||
      s(body.ig_username) ||
      s(body.instagram_username) ||
      undefined;

    const text =
      s(body.text) ||
      s(body.last_input_text) ||
      s(body.lastText) ||
      undefined;

    // ВАЖЛИВО: використовуємо full_name (snake_case), а не fullName
    const full_name =
      s(body.full_name) ||
      s(body.fullname) ||
      s(body.FullName) ||
      s(body.fullName) ||
      undefined;

    const normalized = { username, text, full_name };

    // 1) Знайти card_id «розумним» пошуком (username/full_name),
    //    далі вже працюємо з кампаніями
    const found = await kcFindCardIdByAny({ username, full_name }).catch(() => null);

    if (!found || !found.ok || !found.card_id) {
      return NextResponse.json(
        {
          ok: false,
          via: 'manychat',
          normalized,
          ingest: {
            ok: false,
            error: 'card_not_found',
            hint:
              'Передай username (IG логін без @) і/або full_name (ПІБ). У CRM title має виглядати як «Чат з <ПІБ>», або contact.social_id = IG логін.',
            debug: found ?? null,
          },
        },
        { status: 200 },
      );
    }

    const card_id = String(found.card_id);

    // 2) Дістаємо активні кампанії
    const ids = (await kvZRange('campaigns:index', 0, -1)) as string[] | any;
    const campaigns: any[] = [];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const raw = await kvGet(`campaigns:${id}`);
        if (raw) {
          try {
            const item = JSON.parse(raw);
            if (item?.enabled) campaigns.push(item);
          } catch {}
        }
      }
    }

    // Якщо немає активних кампаній — просто повертаємо found
    if (!campaigns.length) {
      return NextResponse.json(
        {
          ok: true,
          via: 'manychat',
          normalized,
          ingest: { ok: true, applied: null, campaign_id: null, move: null, found },
        },
        { status: 200 },
      );
    }

    // 3) Поточний стан картки
    const state = await kcGetCardState(card_id).catch(() => null);
    const curPipeline = state?.pipeline_id ?? null;
    const curStatus = state?.status_id ?? null;

    // 4) Обходимо кампанії й намагаємось застосувати перший релевантний тригер
    let applied: 'v1' | 'v2' | 'exp' | null = null;
    let moveRes: any = null;
    let usedCampaign: any = null;

    for (const camp of campaigns) {
      // Працюємо тільки якщо картка в базовій парі воронка/статус цієї кампанії
      if (
        String(camp.base_pipeline_id || '') !== String(curPipeline || '') ||
        String(camp.base_status_id || '') !== String(curStatus || '')
      ) {
        continue;
      }

      // Перевірка V1
      if (!applied && camp.v1_field && camp.v1_value) {
        const match =
          camp.v1_op === 'equals'
            ? s(text) === s(camp.v1_value)
            : s(text).toLowerCase().includes(s(camp.v1_value).toLowerCase());
        if (match && camp.v1_to_pipeline_id && camp.v1_to_status_id) {
          moveRes = await kcMoveCard({
            card_id,
            to_pipeline_id: String(camp.v1_to_pipeline_id),
            to_status_id: String(camp.v1_to_status_id),
          }).catch(() => null);
          if (moveRes?.status && moveRes.status >= 200 && moveRes.status < 300) {
            applied = 'v1';
            usedCampaign = camp;
            // лічильник
            await kvSet(
              `campaigns:${camp.id}`,
              JSON.stringify({ ...camp, v1_count: Number(camp.v1_count || 0) + 1 }),
            ).catch(() => {});
            break;
          }
        }
      }

      // Перевірка V2 (опційно)
      if (!applied && camp.v2_enabled && camp.v2_field && camp.v2_value) {
        const match =
          camp.v2_op === 'equals'
            ? s(text) === s(camp.v2_value)
            : s(text).toLowerCase().includes(s(camp.v2_value).toLowerCase());
        if (match && camp.v2_to_pipeline_id && camp.v2_to_status_id) {
          moveRes = await kcMoveCard({
            card_id,
            to_pipeline_id: String(camp.v2_to_pipeline_id),
            to_status_id: String(camp.v2_to_status_id),
          }).catch(() => null);
          if (moveRes?.status && moveRes.status >= 200 && moveRes.status < 300) {
            applied = 'v2';
            usedCampaign = camp;
            await kvSet(
              `campaigns:${camp.id}`,
              JSON.stringify({ ...camp, v2_count: Number(camp.v2_count || 0) + 1 }),
            ).catch(() => {});
            break;
          }
        }
      }

      // Exp ми тут не чіпаємо (окремий воркер/крон)
    }

    return NextResponse.json(
      {
        ok: true,
        via: 'manychat',
        normalized,
        ingest: {
          ok: true,
          applied,
          campaign_id: usedCampaign?.id ?? null,
          move: moveRes,
          found,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'ingest_failed' },
      { status: 500 },
    );
  }
}
