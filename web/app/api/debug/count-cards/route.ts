// web/app/api/debug/count-cards/route.ts
// Діагностичний endpoint для перевірки підрахунку карток в базовій воронці кампанії

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';
import { countCardsInBasePipeline } from '@/lib/campaign-stats';
import { kv } from '@vercel/kv';

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
    let campaignFromVercelKv: any = null;
    
    // Спочатку спробуємо через @vercel/kv (як в адмін-панелі)
    for (const key of keysToTry) {
      try {
        campaignFromVercelKv = await kv.get(key);
        if (campaignFromVercelKv) {
          foundKey = key;
          break;
        }
      } catch {
        // Ігноруємо помилки
      }
    }
    
    // Якщо не знайшли через @vercel/kv, спробуємо через kvRead.getRaw
    if (!campaignFromVercelKv) {
      for (const key of keysToTry) {
        raw = await kvRead.getRaw(key);
        if (raw) {
          foundKey = key;
          break;
        }
      }
    }
    
    if (!campaignFromVercelKv && !raw) {
      return NextResponse.json({ error: 'Campaign not found', triedKeys: keysToTry }, { status: 404 });
    }
    
    // Якщо знайшли через @vercel/kv, використовуємо його
    if (campaignFromVercelKv) {
      const campaign = campaignFromVercelKv;
      const basePipelineId = campaign.base?.pipelineId || 
                             campaign.base?.pipeline_id ||
                             campaign.base?.pipeline ||
                             campaign.base_pipeline_id ||
                             campaign.base_pipelineId;
      const baseStatusId = campaign.base?.statusId || 
                           campaign.base?.status_id ||
                           campaign.base?.status ||
                           campaign.base_status_id ||
                           campaign.baseStatusId;
      const count = await countCardsInBasePipeline(basePipelineId, baseStatusId);
      
      return NextResponse.json({
        ok: true,
        campaignId,
        campaignName: campaign.name,
        foundKey,
        source: 'vercel-kv',
        basePipelineId,
        baseStatusId,
        basePipelineIdType: typeof basePipelineId,
        baseStatusIdType: typeof baseStatusId,
        currentBaseCardsCount: campaign.baseCardsCount,
        countResult: count,
        campaignBase: campaign.base,
        campaignBaseKeys: campaign.base ? Object.keys(campaign.base) : null,
        fullCampaignKeys: Object.keys(campaign).slice(0, 30),
        basePipelineValue: campaign.base?.pipeline,
        baseStatusValue: campaign.base?.status,
      });
    }

    // Парсимо кампанію, можливо вона обгорнута в {value: {...}}
    // kvGetRaw вже намагається розгорнути, але іноді повертає обгортку
    let campaign: any = null;
    let parsed: any = null;
    let debugInfo: any = {
      rawLength: raw.length,
      rawPreview: raw.substring(0, 500),
      foundKey,
    };

    try {
      try {
        parsed = JSON.parse(raw);
        debugInfo.parsedType = typeof parsed;
        debugInfo.isArray = Array.isArray(parsed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          debugInfo.parsedKeys = Object.keys(parsed).slice(0, 10);
          debugInfo.hasValue = 'value' in parsed;
          debugInfo.hasResult = 'result' in parsed;
          debugInfo.hasData = 'data' in parsed;
          if ('value' in parsed) {
            debugInfo.valueType = typeof parsed.value;
            if (typeof parsed.value === 'string') {
              debugInfo.valuePreview = parsed.value.substring(0, 200);
            }
          }
        }
      } catch (parseErr: any) {
        debugInfo.parseError = parseErr.message;
        parsed = raw;
      }

      // Якщо це об'єкт з ключем value, розгортаємо
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if ('value' in parsed) {
          const unwrapped = parsed.value;
          debugInfo.unwrapping = 'from value key';
          debugInfo.unwrappedValueType = typeof unwrapped;
          debugInfo.unwrappedIsObject = unwrapped && typeof unwrapped === 'object';
          debugInfo.unwrappedKeys = unwrapped && typeof unwrapped === 'object' ? Object.keys(unwrapped).slice(0, 10) : null;
          
          if (typeof unwrapped === 'string') {
            try {
              campaign = JSON.parse(unwrapped);
              debugInfo.unwrappedType = 'string->object';
              debugInfo.campaignAfterUnwrap = 'parsed from string';
            } catch {
              campaign = unwrapped;
              debugInfo.unwrappedType = 'string (parse failed)';
              debugInfo.campaignAfterUnwrap = 'string (failed)';
            }
          } else if (unwrapped && typeof unwrapped === 'object') {
            campaign = unwrapped;
            debugInfo.unwrappedType = 'object';
            debugInfo.campaignAfterUnwrap = 'direct object';
          } else {
            campaign = parsed;
            debugInfo.unwrappedType = 'fallback to parsed';
            debugInfo.campaignAfterUnwrap = 'fallback';
          }
        } else if ('result' in parsed) {
          campaign = parsed.result;
          debugInfo.unwrapping = 'from result key';
        } else if ('data' in parsed) {
          campaign = parsed.data;
          debugInfo.unwrapping = 'from data key';
        } else {
          // Перевіряємо, чи це вже кампанія (має поля id, name, base тощо)
          if ('id' in parsed || 'name' in parsed || 'base' in parsed) {
            campaign = parsed;
            debugInfo.unwrapping = 'direct (has id/name/base)';
          } else {
            campaign = parsed;
            debugInfo.unwrapping = 'direct (fallback)';
          }
        }
      } else {
        campaign = parsed;
        debugInfo.unwrapping = 'not an object';
      }

      // Якщо все ще рядок, спробуємо розпарсити ще раз
      if (typeof campaign === 'string') {
        try {
          campaign = JSON.parse(campaign);
          debugInfo.finalParse = 'string->object';
        } catch {
          debugInfo.finalParse = 'string (parse failed)';
        }
      } else {
        debugInfo.finalParse = 'already object';
      }
    } catch (err: any) {
      return NextResponse.json({ 
        error: 'Failed to parse campaign JSON', 
        errorMessage: err.message,
        debugInfo,
        triedKeys: keysToTry 
      }, { status: 500 });
    }

    if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
      return NextResponse.json({ 
        error: 'Campaign is not an object', 
        campaignType: typeof campaign,
        isArray: Array.isArray(campaign),
        debugInfo,
        triedKeys: keysToTry 
      }, { status: 500 });
    }

    debugInfo.campaignKeys = Object.keys(campaign).slice(0, 20);
    debugInfo.campaignHasBase = 'base' in campaign;
    debugInfo.campaignType = typeof campaign;
    debugInfo.campaignIsArray = Array.isArray(campaign);
    
    // Якщо campaign все ще має тільки ключ "value", спробуємо розгорнути ще раз
    if (campaign && typeof campaign === 'object' && !Array.isArray(campaign) && Object.keys(campaign).length === 1 && 'value' in campaign) {
      debugInfo.retryUnwrap = true;
      const retryUnwrapped = campaign.value;
      if (typeof retryUnwrapped === 'string') {
        try {
          campaign = JSON.parse(retryUnwrapped);
          debugInfo.retryResult = 'string->object';
        } catch {
          debugInfo.retryResult = 'string (parse failed)';
        }
      } else if (retryUnwrapped && typeof retryUnwrapped === 'object') {
        campaign = retryUnwrapped;
        debugInfo.retryResult = 'object';
      }
      debugInfo.campaignKeysAfterRetry = Object.keys(campaign).slice(0, 20);
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
      debugInfo,
    });
  } catch (err: any) {
    return NextResponse.json({ 
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    }, { status: 500 });
  }
}

