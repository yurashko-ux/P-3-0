// web/lib/exp-check.ts
// Функції для перевірки та переміщення карток після експірації EXP

import { keycrmHeaders, keycrmUrl } from '@/lib/env';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { moveKeycrmCard } from '@/lib/keycrm-move';
import { getExpTracking, deleteExpTracking, extractTimestampFromKeycrmCard } from './exp-tracking';
import { updateCampaignBaseCardsCount } from './campaign-stats';

export type ExpCheckResult = {
  campaignId: string;
  campaignName: string;
  cardsChecked: number;
  cardsMoved: number;
  errors: string[];
};

/**
 * Отримує всі картки з базової воронки/статусу кампанії
 */
async function getCardsFromBasePipeline(
  pipelineId: number,
  statusId: number,
  perPage = 50,
  maxPages = 20
): Promise<Array<{ id: number; [key: string]: any }>> {
  const cards: Array<{ id: number; [key: string]: any }> = [];
  
  console.log(`[exp-check] getCardsFromBasePipeline: Starting fetch`, {
    pipelineId,
    statusId,
    perPage,
    maxPages,
  });
  
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      pipeline_id: String(pipelineId),
      status_id: String(statusId),
    });
    
    const url = keycrmUrl(`/pipelines/cards?${qs.toString()}`);
    console.log(`[exp-check] getCardsFromBasePipeline: Fetching page ${page}`, { url });
    
    const res = await fetch(url, {
      headers: keycrmHeaders(),
      cache: 'no-store',
    });
    
    if (!res.ok) {
      console.log(`[exp-check] getCardsFromBasePipeline: API error`, {
        page,
        status: res.status,
        statusText: res.statusText,
      });
      if (res.status === 404 || page > 1) break; // Немає більше сторінок
      throw new Error(`KeyCRM API error: ${res.status} ${res.statusText}`);
    }
    
    const json = await res.json();
    const data = Array.isArray(json) 
      ? json 
      : Array.isArray(json?.data) 
        ? json.data 
        : [];
    
    console.log(`[exp-check] getCardsFromBasePipeline: Page ${page} returned ${data.length} items`);
    
    if (data.length === 0) break;
    
    for (const card of data) {
      const cardId = card?.id ?? card?.card_id;
      if (cardId && typeof cardId === 'number') {
        cards.push({ id: cardId, ...card });
      }
    }
    
    console.log(`[exp-check] getCardsFromBasePipeline: Page ${page} added ${data.length} cards, total: ${cards.length}`);
    
    // Перевіряємо, чи є наступна сторінка
    const hasNext = json?.links?.next || json?.next_page_url || 
      (json?.meta?.current_page ?? json?.current_page ?? page) < (json?.meta?.last_page ?? json?.last_page ?? page);
    if (!hasNext) break;
  }
  
  console.log(`[exp-check] getCardsFromBasePipeline: Total cards found: ${cards.length}`);
  
  return cards;
}

/**
 * Отримує деталі картки з KeyCRM (для отримання updated_at)
 */
async function getCardDetails(cardId: number): Promise<any> {
  const res = await fetch(keycrmUrl(`/pipelines/cards/${cardId}`), {
    headers: keycrmHeaders(),
    cache: 'no-store',
  });
  
  if (!res.ok) {
    throw new Error(`Failed to get card details: ${res.status}`);
  }
  
  return await res.json();
}

/**
 * Перевіряє одну кампанію та переміщує картки з базової воронки в цільову EXP воронку
 * 
 * Логіка:
 * - EXP=0: негайне переміщення (той самий день) - всі картки в базовій воронці переміщуються одразу
 * - EXP>0: переміщення через expDays днів після переміщення в базову воронку
 * 
 * Працює для карток:
 * - Переміщених автоматично через v1/v2 (timestamp з KV)
 * - Переміщених вручну безпосередньо в KeyCRM (updated_at з KeyCRM)
 */
export async function checkCampaignExp(campaign: any): Promise<ExpCheckResult> {
  const result: ExpCheckResult = {
    campaignId: campaign.id || '',
    campaignName: campaign.name || 'Unknown',
    cardsChecked: 0,
    cardsMoved: 0,
    errors: [],
  };
  
  try {
    // Перевіряємо, чи кампанія має EXP
    // Перевіряємо всі можливі поля для EXP, ігноруючи undefined
    const expDaysRaw = campaign.expDays ?? campaign.expireDays ?? campaign.exp ?? campaign.vexp ?? campaign.expire;
    // Конвертуємо рядок в число, якщо потрібно
    const expDays = typeof expDaysRaw === 'string' ? Number(expDaysRaw) : expDaysRaw;
    
    console.log(`[exp-check] Campaign ${campaign.id} (${campaign.name}): Checking EXP configuration`, {
      expDays,
      expDaysType: typeof expDays,
      expDaysRaw,
      expDaysRawType: typeof expDaysRaw,
      hasExpDays: 'expDays' in campaign,
      hasExpireDays: 'expireDays' in campaign,
      hasExp: 'exp' in campaign,
      hasVexp: 'vexp' in campaign,
      hasExpire: 'expire' in campaign,
      expDaysValue: campaign.expDays,
      expValue: campaign.exp,
    });
    
    if (expDays == null || (typeof expDays !== 'number') || isNaN(expDays) || expDays < 0) {
      console.log(`[exp-check] Campaign ${campaign.id}: No valid EXP configuration, skipping`, {
        expDays,
        expDaysType: typeof expDays,
        expDaysRaw,
        expDaysRawType: typeof expDaysRaw,
      });
      return result; // Кампанія не має EXP (або негативне значення)
    }
    
    // Перевіряємо, чи є цільова воронка EXP
    const texp = campaign.texp;
    const texpPipelineId = texp?.pipelineId || texp?.pipeline;
    const texpStatusId = texp?.statusId || texp?.status;
    
    console.log(`[exp-check] Campaign ${campaign.id}: Checking texp configuration`, {
      hasTexp: !!texp,
      texpPipelineId,
      texpStatusId,
      texp: texp,
    });
    
    if (!texp || !texpPipelineId || !texpStatusId) {
      console.log(`[exp-check] Campaign ${campaign.id}: No valid texp configuration, skipping`, {
        texp,
        texpPipelineId,
        texpStatusId,
      });
      return result; // Немає цільової воронки EXP
    }
    
    // Перевіряємо базову воронку
    const basePipelineId = campaign.base?.pipelineId || campaign.base?.pipeline || campaign.base_pipeline_id;
    const baseStatusId = campaign.base?.statusId || campaign.base?.status || campaign.base_status_id;
    
    console.log(`[exp-check] Campaign ${campaign.id} (${campaign.name}):`, {
      expDays,
      hasTexp: !!texp,
      texpPipelineId: texp?.pipelineId,
      texpStatusId: texp?.statusId,
      basePipelineId,
      baseStatusId,
      base: campaign.base,
    });
    
    if (!basePipelineId || !baseStatusId) {
      console.log(`[exp-check] Campaign ${campaign.id}: Missing base pipeline/status`, {
        basePipelineId,
        baseStatusId,
        base: campaign.base,
      });
      return result; // Немає базової воронки
    }
    
    const basePipelineIdNum = Number(basePipelineId);
    const baseStatusIdNum = Number(baseStatusId);
    
    if (!Number.isFinite(basePipelineIdNum) || !Number.isFinite(baseStatusIdNum)) {
      console.log(`[exp-check] Campaign ${campaign.id}: Invalid base pipeline/status IDs`, {
        basePipelineId,
        baseStatusId,
        basePipelineIdNum,
        baseStatusIdNum,
      });
      return result; // Невалідні ID
    }
    
    console.log(`[exp-check] Campaign ${campaign.id}: Fetching cards from base pipeline`, {
      basePipelineIdNum,
      baseStatusIdNum,
    });
    
    // Отримуємо всі картки з базової воронки
    const cards = await getCardsFromBasePipeline(basePipelineIdNum, baseStatusIdNum);
    result.cardsChecked = cards.length;
    
    console.log(`[exp-check] Campaign ${campaign.id}: Found ${cards.length} cards in base pipeline`);
    
    const now = Date.now();
    const isImmediate = expDays === 0; // EXP=0 означає негайне переміщення (той самий день)
    const expDaysMs = expDays * 24 * 60 * 60 * 1000;
    
    const targetPipelineId = String(texpPipelineId);
    const targetStatusId = String(texpStatusId);
    
    // Перевіряємо кожну картку
    for (const card of cards) {
      try {
        const cardId = String(card.id);
        
        // Спробувати отримати timestamp переміщення в базову воронку
        // 1. Спочатку перевіряємо KV (для карток, переміщених через v1/v2 автоматично)
        // 2. Якщо немає в KV - використовуємо updated_at з KeyCRM
        //    (це працює для карток, переміщених вручну безпосередньо в KeyCRM)
        let timestamp: number | null = null;
        const tracking = await getExpTracking(campaign.id, cardId);
        
        if (tracking) {
          // Картка була переміщена через v1/v2 - використовуємо точний timestamp з KV
          timestamp = tracking.timestamp;
        } else {
          // Картка не знайдена в KV - використовуємо updated_at з KeyCRM
          // Це працює для карток, які були переміщені вручну в KeyCRM
          try {
            const cardDetails = await getCardDetails(card.id);
            timestamp = extractTimestampFromKeycrmCard(cardDetails);
          } catch (err) {
            // Якщо не вдалося отримати - пропускаємо картку
            result.errors.push(`Card ${cardId}: failed to get timestamp`);
            continue;
          }
        }
        
        // Якщо EXP=0, переміщуємо всі картки одразу (незалежно від timestamp)
        // Якщо EXP>0, перевіряємо чи пройшло достатньо днів
        let shouldMove = false;
        
        if (isImmediate) {
          // EXP=0: негайне переміщення - переміщуємо всі картки, які знаходяться в базовій воронці
          shouldMove = true;
        } else {
          // EXP>0: перевіряємо час перебування в базовій воронці
          if (!timestamp) {
            // Немає інформації про час - пропускаємо
            continue;
          }
          
          const timeInBase = now - timestamp;
          
          // Якщо пройшло достатньо днів - переміщуємо
          if (timeInBase >= expDaysMs) {
            shouldMove = true;
          }
        }
        
        if (shouldMove) {
          try {
            const moveResult = await moveKeycrmCard({
              cardId,
              pipelineId: targetPipelineId,
              statusId: targetStatusId,
              pipelineStatusId: texp.pipelineStatusId ? String(texp.pipelineStatusId) : null,
              statusAliases: Array.isArray(texp.statusAliases) ? texp.statusAliases.map(String) : [],
            });
            
          if (moveResult.ok) {
            result.cardsMoved++;
            
            // Видаляємо tracking запис
            await deleteExpTracking(campaign.id, cardId);
            
            // Інкрементуємо лічильник exp_count та оновлюємо статистику
            try {
              const itemKey = campaignKeys.ITEM_KEY(campaign.id);
              const raw = await kvRead.getRaw(itemKey);
              if (raw) {
                const obj = JSON.parse(raw);
                obj.exp_count = (typeof obj.exp_count === 'number' ? obj.exp_count : 0) + 1;
                
                // Оновлюємо лічильники переміщених карток
                const v1Count = obj.counters?.v1 || obj.v1_count || 0;
                const v2Count = obj.counters?.v2 || obj.v2_count || 0;
                const expCount = obj.exp_count;
                
                obj.movedTotal = v1Count + v2Count + expCount;
                obj.movedV1 = v1Count;
                obj.movedV2 = v2Count;
                obj.movedExp = expCount;
                
                // baseCardsTotalPassed не змінюється при переміщенні карток
                // Він оновлюється тільки при перерахуванні статистики (updateCampaignBaseCardsCount)
                // коли виявляються нові картки, додані вручну в KeyCRM
                
                // Зберігаємо через обидва методи для сумісності
                await kvWrite.setRaw(itemKey, JSON.stringify(obj));
                // Також спробуємо зберегти через @vercel/kv для сумісності
                try {
                  const { kv } = await import('@vercel/kv');
                  await kv.set(itemKey, obj);
                } catch {
                  // Ігноруємо помилки @vercel/kv
                }
              }
            } catch {
              // Ігноруємо помилки інкременту лічильника
            }
          } else {
            result.errors.push(`Card ${cardId}: move failed (status ${moveResult.status})`);
          }
          } catch (err) {
            result.errors.push(`Card ${cardId}: move error - ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        result.errors.push(`Card ${card.id}: check error - ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    // Оновлюємо кількість карток в базовій воронці для кампаній з EXP (раз на день)
    try {
      await updateCampaignBaseCardsCount(campaign.id);
    } catch (err) {
      // Ігноруємо помилки оновлення статистики - не критично
      if (process.env.NODE_ENV !== 'production') {
        result.errors.push(`Failed to update base cards count: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Campaign check error: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  return result;
}

