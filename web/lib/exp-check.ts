// web/lib/exp-check.ts
// Функції для перевірки та переміщення карток після експірації EXP

import { keycrmHeaders, keycrmUrl } from '@/lib/env';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { moveKeycrmCard } from '@/lib/keycrm-move';
import { getExpTracking, deleteExpTracking, extractTimestampFromKeycrmCard } from './exp-tracking';

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
  
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      pipeline_id: String(pipelineId),
      status_id: String(statusId),
    });
    
    const res = await fetch(keycrmUrl(`/pipelines/cards?${qs.toString()}`), {
      headers: keycrmHeaders(),
      cache: 'no-store',
    });
    
    if (!res.ok) {
      if (res.status === 404 || page > 1) break; // Немає більше сторінок
      throw new Error(`KeyCRM API error: ${res.status} ${res.statusText}`);
    }
    
    const json = await res.json();
    const data = Array.isArray(json) 
      ? json 
      : Array.isArray(json?.data) 
        ? json.data 
        : [];
    
    if (data.length === 0) break;
    
    for (const card of data) {
      const cardId = card?.id ?? card?.card_id;
      if (cardId && typeof cardId === 'number') {
        cards.push({ id: cardId, ...card });
      }
    }
    
    // Перевіряємо, чи є наступна сторінка
    const hasNext = json?.links?.next || json?.next_page_url || 
      (json?.meta?.current_page ?? json?.current_page ?? page) < (json?.meta?.last_page ?? json?.last_page ?? page);
    if (!hasNext) break;
  }
  
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
 * Перевіряє одну кампанію та переміщує картки, які перебувають у базовій воронці більше expDays днів
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
    const expDays = campaign.expDays || campaign.expireDays || campaign.exp || campaign.vexp || campaign.expire;
    if (!expDays || typeof expDays !== 'number' || expDays <= 0) {
      return result; // Кампанія не має EXP
    }
    
    // Перевіряємо, чи є цільова воронка EXP
    const texp = campaign.texp;
    if (!texp || !texp.pipelineId || !texp.statusId) {
      return result; // Немає цільової воронки EXP
    }
    
    // Перевіряємо базову воронку
    const basePipelineId = campaign.base?.pipelineId || campaign.base_pipeline_id;
    const baseStatusId = campaign.base?.statusId || campaign.base_status_id;
    
    if (!basePipelineId || !baseStatusId) {
      return result; // Немає базової воронки
    }
    
    const basePipelineIdNum = Number(basePipelineId);
    const baseStatusIdNum = Number(baseStatusId);
    
    if (!Number.isFinite(basePipelineIdNum) || !Number.isFinite(baseStatusIdNum)) {
      return result; // Невалідні ID
    }
    
    // Отримуємо всі картки з базової воронки
    const cards = await getCardsFromBasePipeline(basePipelineIdNum, baseStatusIdNum);
    result.cardsChecked = cards.length;
    
    const now = Date.now();
    const expDaysMs = expDays * 24 * 60 * 60 * 1000;
    
    const targetPipelineId = String(texp.pipelineId);
    const targetStatusId = String(texp.statusId);
    
    // Перевіряємо кожну картку
    for (const card of cards) {
      try {
        const cardId = String(card.id);
        
        // Спробувати отримати timestamp з KV
        let timestamp: number | null = null;
        const tracking = await getExpTracking(campaign.id, cardId);
        
        if (tracking) {
          timestamp = tracking.timestamp;
        } else {
          // Fallback на updated_at з KeyCRM
          try {
            const cardDetails = await getCardDetails(card.id);
            timestamp = extractTimestampFromKeycrmCard(cardDetails);
          } catch (err) {
            // Якщо не вдалося отримати - пропускаємо картку
            result.errors.push(`Card ${cardId}: failed to get timestamp`);
            continue;
          }
        }
        
        if (!timestamp) {
          // Немає інформації про час - пропускаємо
          continue;
        }
        
        const timeInBase = now - timestamp;
        
        // Якщо пройшло достатньо днів - переміщуємо
        if (timeInBase >= expDaysMs) {
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
            
            // Інкрементуємо лічильник exp_count
            try {
              const itemKey = campaignKeys.ITEM_KEY(campaign.id);
              const raw = await kvRead.getRaw(itemKey);
              if (raw) {
                const obj = JSON.parse(raw);
                obj.exp_count = (typeof obj.exp_count === 'number' ? obj.exp_count : 0) + 1;
                await kvWrite.setRaw(itemKey, JSON.stringify(obj));
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
  } catch (err) {
    result.errors.push(`Campaign check error: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  return result;
}

