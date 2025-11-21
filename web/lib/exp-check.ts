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

// Кеш для результатів отримання карток (щоб уникнути дублювання запитів для однакових pipelineId/statusId)
const cardsCache = new Map<string, Array<{ id: number; [key: string]: any }>>();

/**
 * Очищає кеш карток (викликається на початку кожного cron job)
 */
export function clearCardsCache(): void {
  cardsCache.clear();
  console.log('[exp-check] Cards cache cleared');
}

/**
 * Отримує всі картки з базової воронки/статусу кампанії
 * Використовує кеш для однакових pipelineId/statusId
 */
async function getCardsFromBasePipeline(
  pipelineId: number,
  statusId: number,
  perPage = 50,
  maxPages = 20,
  useCache = true
): Promise<Array<{ id: number; [key: string]: any }>> {
  // Перевіряємо кеш
  const cacheKey = `${pipelineId}:${statusId}`;
  if (useCache && cardsCache.has(cacheKey)) {
    console.log(`[exp-check] getCardsFromBasePipeline: Using cached result for ${cacheKey}`, {
      cachedCardsCount: cardsCache.get(cacheKey)!.length,
    });
    return cardsCache.get(cacheKey)!;
  }
  const cards: Array<{ id: number; [key: string]: any }> = [];
  
  console.log(`[exp-check] getCardsFromBasePipeline: Starting fetch`, {
    pipelineId,
    statusId,
    perPage,
    maxPages,
  });
  
  for (let page = 1; page <= maxPages; page++) {
    // Додаємо затримку між запитами, щоб уникнути rate limiting
    // Зменшуємо затримку для оптимізації
    if (page > 1) {
      await new Promise(resolve => setTimeout(resolve, 200)); // 200ms затримка між сторінками (було 500ms)
    }
    
    const qs = new URLSearchParams();
    qs.set("page[number]", String(page));
    qs.set("page[size]", String(perPage));
    
    // Використовуємо правильний формат фільтрів, як у keycrm-card-search.ts
    if (statusId != null) {
      qs.set("filter[status_id]", String(statusId));
    }
    
    if (pipelineId != null) {
      qs.set("filter[pipeline_id]", String(pipelineId));
    }
    
    // Додаємо include та with параметри для отримання повної інформації про картки
    const relations = ["contact", "contact.client", "status"];
    for (const relation of relations) {
      qs.append("include[]", relation);
      qs.append("with[]", relation);
    }
    
    const url = keycrmUrl(`/pipelines/cards?${qs.toString()}`);
    console.log(`[exp-check] getCardsFromBasePipeline: Fetching page ${page}`, { url });
    
    let res: Response;
    let retries = 3;
    let lastError: Error | null = null;
    
    // Retry логіка для обробки rate limiting
    while (retries > 0) {
      try {
        res = await fetch(url, {
          headers: keycrmHeaders(),
          cache: 'no-store',
        });
        
        if (res.status === 429) {
          // Rate limiting - чекаємо і повторюємо
          const retryAfter = res.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000; // За замовчуванням 2 секунди
          console.log(`[exp-check] getCardsFromBasePipeline: Rate limited, waiting ${waitTime}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retries--;
          continue;
        }
        
        break; // Успішний запит або інша помилка
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        retries--;
        if (retries > 0) {
          console.log(`[exp-check] getCardsFromBasePipeline: Request failed, retrying...`, { error: lastError.message });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    if (!res!) {
      throw lastError || new Error('Failed to fetch after retries');
    }
    
    if (!res.ok) {
      console.log(`[exp-check] getCardsFromBasePipeline: API error`, {
        page,
        status: res.status,
        statusText: res.statusText,
      });
      if (res.status === 404 || page > 1) break; // Немає більше сторінок
      if (res.status === 429) {
        throw new Error(`KeyCRM API rate limit exceeded. Please try again later.`);
      }
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
    
    // Ручна фільтрація карток по status_id, оскільки KeyCRM API може не фільтрувати правильно
    let filteredCount = 0;
    let skippedByStatus = 0;
    for (const card of data) {
      const cardId = card?.id ?? card?.card_id;
      if (cardId && typeof cardId === 'number') {
        // Перевіряємо, чи картка належить до потрібного статусу
        // Перевіряємо всі можливі місця, де може бути status_id
        const cardStatusId = card?.status_id ?? card?.statusId ?? card?.status?.id ?? card?.status ?? 
                             card?.pipeline_status_id ?? card?.pipelineStatusId;
        
        // Нормалізуємо status_id до числа
        let cardStatusIdNum: number | null = null;
        if (cardStatusId != null) {
          if (typeof cardStatusId === 'number' && Number.isFinite(cardStatusId)) {
            cardStatusIdNum = cardStatusId;
          } else if (typeof cardStatusId === 'string') {
            const parsed = Number(cardStatusId);
            if (Number.isFinite(parsed)) {
              cardStatusIdNum = parsed;
            }
          }
        }
        
        // Якщо status_id не знайдено або не співпадає з очікуваним - пропускаємо картку
        if (cardStatusIdNum === null || cardStatusIdNum !== statusId) {
          skippedByStatus++;
          if (skippedByStatus <= 3) { // Логуємо тільки перші 3 для діагностики
            console.log(`[exp-check] getCardsFromBasePipeline: Skipping card ${cardId} - status mismatch`, {
              cardStatusId,
              cardStatusIdNum,
              expectedStatusId: statusId,
              hasStatus: cardStatusId != null,
              cardKeys: Object.keys(card),
            });
          }
          continue;
        }
        
        cards.push({ id: cardId, ...card });
        filteredCount++;
      }
    }
    
    if (skippedByStatus > 0) {
      console.log(`[exp-check] getCardsFromBasePipeline: Page ${page} - skipped ${skippedByStatus} cards due to status mismatch`);
    }
    
    console.log(`[exp-check] getCardsFromBasePipeline: Page ${page} - filtered ${filteredCount} cards (from ${data.length} total), total in cache: ${cards.length}`);
    
    // Перевіряємо, чи є наступна сторінка
    const hasNext = json?.links?.next || json?.next_page_url || 
      (json?.meta?.current_page ?? json?.current_page ?? page) < (json?.meta?.last_page ?? json?.last_page ?? page);
    if (!hasNext) break;
  }
  
  console.log(`[exp-check] getCardsFromBasePipeline: Total cards found: ${cards.length}`);
  
  // Зберігаємо в кеш
  if (useCache) {
    cardsCache.set(cacheKey, cards);
    console.log(`[exp-check] getCardsFromBasePipeline: Cached result for ${cacheKey}`);
  }
  
  return cards;
}

/**
 * Отримує деталі картки з KeyCRM (для отримання updated_at)
 */
async function getCardDetails(cardId: number): Promise<any> {
  let res: Response;
  let retries = 3;
  let lastError: Error | null = null;
  
  // Retry логіка для обробки rate limiting
  while (retries > 0) {
    try {
      res = await fetch(keycrmUrl(`/pipelines/cards/${cardId}`), {
        headers: keycrmHeaders(),
        cache: 'no-store',
      });
      
      if (res.status === 429) {
        // Rate limiting - чекаємо і повторюємо
        const retryAfter = res.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
        console.log(`[exp-check] getCardDetails: Rate limited for card ${cardId}, waiting ${waitTime}ms before retry`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries--;
        continue;
      }
      
      break; // Успішний запит або інша помилка
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  if (!res!) {
    throw lastError || new Error('Failed to fetch card details after retries');
  }
  
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(`KeyCRM API rate limit exceeded. Please try again later.`);
    }
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
    console.log(`[exp-check] Campaign ${campaign.id}: Fetching cards from base pipeline`, {
      basePipelineId: basePipelineIdNum,
      baseStatusId: baseStatusIdNum,
      expDays,
      isImmediate: expDays === 0,
    });
    
    const cards = await getCardsFromBasePipeline(basePipelineIdNum, baseStatusIdNum);
    result.cardsChecked = cards.length;
    
    console.log(`[exp-check] Campaign ${campaign.id}: Found ${cards.length} cards in base pipeline/status`, {
      basePipelineId: basePipelineIdNum,
      baseStatusId: baseStatusIdNum,
      expDays,
      isImmediate: expDays === 0,
    });
    
    const now = Date.now();
    const isImmediate = expDays === 0; // EXP=0 означає негайне переміщення (той самий день)
    const expDaysMs = expDays * 24 * 60 * 60 * 1000;
    
    const targetPipelineId = String(texpPipelineId);
    const targetStatusId = String(texpStatusId);
    
    // Перевіряємо кожну картку
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      
      // Затримки потрібні тільки для великих наборів (>20 карток) для уникнення rate limiting
      if (i > 0 && cards.length > 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      try {
        const cardId = String(card.id);
        
        // Спробувати отримати timestamp переміщення в базову воронку
        // 1. Спочатку перевіряємо KV (для карток, переміщених через v1/v2 автоматично)
        // 2. Якщо немає в KV - використовуємо updated_at з об'єкта card з API
        // 3. Тільки якщо не знайшли в об'єкті card - робимо окремий запит до KeyCRM
        let timestamp: number | null = null;
        const tracking = await getExpTracking(campaign.id, cardId);
        
        if (tracking) {
          // Картка була переміщена через v1/v2 - використовуємо точний timestamp з KV
          timestamp = tracking.timestamp;
        } else {
          // Спочатку перевіряємо updated_at в об'єкті card з API (оптимізація - не робимо зайвих запитів)
          if (card.updated_at || card.updatedAt || card.updated) {
            timestamp = extractTimestampFromKeycrmCard(card);
            if (timestamp) {
              console.log(`[exp-check] Campaign ${campaign.id}: Using timestamp from card object for card ${cardId}`);
            }
          }
          
          // Тільки якщо не знайшли timestamp в об'єкті card, робимо окремий запит
          if (!timestamp) {
            try {
              const cardDetails = await getCardDetails(card.id);
              timestamp = extractTimestampFromKeycrmCard(cardDetails);
            } catch (err) {
              // Якщо не вдалося отримати - пропускаємо картку
              const errorMsg = err instanceof Error ? err.message : String(err);
              result.errors.push(`Card ${cardId}: failed to get timestamp (${errorMsg})`);
              continue;
            }
          }
        }
        
        // Якщо EXP=0, переміщуємо всі картки одразу (незалежно від timestamp)
        // Якщо EXP>0, перевіряємо чи пройшло достатньо днів
        let shouldMove = false;
        
        if (isImmediate) {
          // EXP=0: негайне переміщення - переміщуємо всі картки, які знаходяться в базовій воронці
          // Але тільки ті, які дійсно належать до цієї кампанії (вже відфільтровані в getCardsFromBasePipeline)
          shouldMove = true;
          console.log(`[exp-check] Campaign ${campaign.id}: EXP=0 - will move card ${cardId} immediately`);
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
            console.log(`[exp-check] Campaign ${campaign.id}: Successfully moved card ${cardId} to EXP target`);
            
            // Видаляємо tracking запис
            await deleteExpTracking(campaign.id, cardId);
            
            // Інкрементуємо лічильник exp_count та оновлюємо статистику
            try {
              const itemKey = campaignKeys.ITEM_KEY(campaign.id);
              const raw = await kvRead.getRaw(itemKey);
              if (raw) {
                const obj = JSON.parse(raw);
                const oldExpCount = typeof obj.exp_count === 'number' ? obj.exp_count : 0;
                obj.exp_count = oldExpCount + 1;
                
                // Оновлюємо лічильники переміщених карток
                const v1Count = obj.counters?.v1 || obj.v1_count || 0;
                const v2Count = obj.counters?.v2 || obj.v2_count || 0;
                const expCount = obj.exp_count;
                
                obj.movedTotal = v1Count + v2Count + expCount;
                obj.movedV1 = v1Count;
                obj.movedV2 = v2Count;
                obj.movedExp = expCount;
                
                console.log(`[exp-check] Campaign ${campaign.id}: Updated counters`, {
                  expCount,
                  oldExpCount,
                  movedTotal: obj.movedTotal,
                });
                
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
                
                console.log(`[exp-check] Campaign ${campaign.id}: Saved updated campaign to KV`);
              } else {
                console.warn(`[exp-check] Campaign ${campaign.id}: Campaign not found in KV for counter update`);
              }
            } catch (err) {
              console.error(`[exp-check] Campaign ${campaign.id}: Error updating exp_count`, err);
              // Ігноруємо помилки інкременту лічильника, але логуємо їх
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
    
    // ПРИБРАНО: updateCampaignBaseCardsCount викликається не критично для переміщення карток
    // і може сповільнити процес. Статистику можна оновлювати окремо через cron або при необхідності.
    
  } catch (err) {
    result.errors.push(`Campaign check error: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  return result;
}

