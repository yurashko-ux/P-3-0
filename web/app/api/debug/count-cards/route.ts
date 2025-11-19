// web/app/api/debug/count-cards/route.ts
// Діагностичний endpoint для перевірки підрахунку карток в базовій воронці кампанії

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';
import { countCardsInBasePipeline } from '@/lib/campaign-stats';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const campaignId = u.searchParams.get('campaign_id');
  
  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
  }

  try {
    // Спробуємо різні ключі, бо кампанії можуть зберігатись під різними ключами
    const keysToTry = [
      campaignKeys.ITEM_KEY(campaignId),      // campaign:${id}
      campaignKeys.CMP_ITEM_KEY(campaignId),  // cmp:item:${id}
      campaignKeys.LEGACY_ITEM_KEY(campaignId), // campaigns:${id}
    ];
    
    let raw: string | null = null;
    let foundKey: string | null = null;
    for (const key of keysToTry) {
      raw = await kvRead.getRaw(key);
      if (raw) {
        foundKey = key;
        break;
      }
    }
    
    if (!raw) {
      return NextResponse.json({ error: 'Campaign not found', triedKeys: keysToTry }, { status: 404 });
    }

    // Парсимо кампанію, можливо вона обгорнута в {value: {...}}
    let campaign: any = null;
    try {
      const parsed = JSON.parse(raw);
      // Перевіряємо, чи це обгортка з value (як у kvGetRaw)
      if (parsed && typeof parsed === 'object') {
        // Спробуємо знайти кампанію в різних місцях
        const candidate = parsed.value ?? parsed.result ?? parsed.data ?? parsed;
        
        if (typeof candidate === 'string') {
          campaign = JSON.parse(candidate);
        } else if (candidate && typeof candidate === 'object') {
          campaign = candidate;
        } else {
          campaign = parsed;
        }
      } else {
        campaign = parsed;
      }
    } catch {
      return NextResponse.json({ 
        error: 'Failed to parse campaign JSON', 
        rawPreview: raw.substring(0, 200),
        triedKeys: keysToTry 
      }, { status: 500 });
    }

    if (!campaign || typeof campaign !== 'object') {
      return NextResponse.json({ 
        error: 'Campaign is not an object', 
        rawPreview: raw.substring(0, 200),
        triedKeys: keysToTry 
      }, { status: 500 });
    }
    
    // Перевіряємо всі можливі місця, де може бути pipeline_id/status_id
    // Увага: base.pipeline/base.status - це рядки, а не base.pipelineId/base.statusId
    const basePipelineId = campaign.base?.pipelineId || 
                           campaign.base?.pipeline_id ||
                           campaign.base?.pipeline ||  // ← додав base.pipeline (рядок)
                           campaign.base_pipeline_id ||
                           campaign.base_pipelineId;
    const baseStatusId = campaign.base?.statusId || 
                         campaign.base?.status_id ||
                         campaign.base?.status ||  // ← додав base.status (рядок)
                         campaign.base_status_id ||
                         campaign.baseStatusId;

    const count = await countCardsInBasePipeline(basePipelineId, baseStatusId);

    return NextResponse.json({
      ok: true,
      campaignId,
      campaignName: campaign.name,
      foundKey, // ключ, під яким знайдено кампанію
      basePipelineId,
      baseStatusId,
      basePipelineIdType: typeof basePipelineId,
      baseStatusIdType: typeof baseStatusId,
      currentBaseCardsCount: campaign.baseCardsCount,
      countResult: count,
      campaignBase: campaign.base,
      campaignBaseKeys: campaign.base ? Object.keys(campaign.base) : null,
      fullCampaignKeys: Object.keys(campaign).slice(0, 30), // перші 30 ключів
      // Додаткова діагностика
      basePipelineValue: campaign.base?.pipeline,
      baseStatusValue: campaign.base?.status,
      basePipelineIdValue: campaign.base_pipeline_id,
      baseStatusIdValue: campaign.base_status_id,
      // Діагностика структури
      rawPreview: raw.substring(0, 300), // перші 300 символів сирого рядка
      parsedType: typeof campaign,
      hasValue: 'value' in campaign,
      hasBase: 'base' in campaign,
      hasName: 'name' in campaign,
    });
  } catch (err: any) {
    return NextResponse.json({ 
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    }, { status: 500 });
  }
}

