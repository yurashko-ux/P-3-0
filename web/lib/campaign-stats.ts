// web/lib/campaign-stats.ts
// Функції для підрахунку та оновлення статистики кампаній

import { keycrmHeaders, keycrmUrl } from '@/lib/env';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { kv } from '@vercel/kv';

/**
 * Підраховує кількість карток у базовій воронці/статусі кампанії
 */
export async function countCardsInBasePipeline(
  pipelineId: number | string | null | undefined,
  statusId: number | string | null | undefined
): Promise<number> {
  if (!pipelineId || !statusId) {
    return 0;
  }

  const pipelineIdNum = Number(pipelineId);
  const statusIdNum = Number(statusId);

  if (!Number.isFinite(pipelineIdNum) || !Number.isFinite(statusIdNum)) {
    return 0;
  }

  let total = 0;
  const perPage = 50;
  const maxPages = 20;

  try {
    for (let page = 1; page <= maxPages; page++) {
      // Використовуємо JSON:API формат для фільтрації (як в keycrm-card-search.ts)
      const qs = new URLSearchParams();
      qs.set('page[number]', String(page));
      qs.set('page[size]', String(perPage));
      qs.set('filter[pipeline_id]', String(pipelineIdNum));
      qs.set('filter[status_id]', String(statusIdNum));
      
      // Також додаємо звичайний формат для сумісності
      qs.set('pipeline_id', String(pipelineIdNum));
      qs.set('status_id', String(statusIdNum));

      const url = keycrmUrl(`/pipelines/cards?${qs.toString()}`);
      
      // Логування для діагностики (тільки в dev режимі)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[campaign-stats] Counting cards:', { pipelineId: pipelineIdNum, statusId: statusIdNum, page, url });
      }

      const res = await fetch(url, {
        headers: keycrmHeaders(),
        cache: 'no-store',
      });

      if (!res.ok) {
        if (res.status === 404 || page > 1) break; // Немає більше сторінок
        const errorText = await res.text().catch(() => '');
        throw new Error(`KeyCRM API error: ${res.status} ${res.statusText} - ${errorText.slice(0, 200)}`);
      }

      const json = await res.json();
      const data = Array.isArray(json) 
        ? json 
        : Array.isArray(json?.data) 
          ? json.data 
          : [];

      if (data.length === 0) break;

      // Додаткова перевірка: фільтруємо картки вручну, якщо API не відфільтрував правильно
      const filteredData = data.filter((card: any) => {
        // Перевіряємо всі можливі місця, де може бути pipeline_id та status_id
        const cardPipelineId = card?.pipeline_id ?? 
                               card?.pipeline?.id ?? 
                               card?.pipeline_id ??
                               card?.attributes?.pipeline_id ??
                               card?.data?.pipeline_id;
        const cardStatusId = card?.status_id ?? 
                             card?.status?.id ?? 
                             card?.status_id ??
                             card?.attributes?.status_id ??
                             card?.data?.status_id;
        
        // Нормалізуємо до чисел для порівняння
        const cardPipelineIdNum = typeof cardPipelineId === 'number' ? cardPipelineId : Number(cardPipelineId);
        const cardStatusIdNum = typeof cardStatusId === 'number' ? cardStatusId : Number(cardStatusId);
        
        const pipelineMatch = Number.isFinite(cardPipelineIdNum) && cardPipelineIdNum === pipelineIdNum;
        const statusMatch = Number.isFinite(cardStatusIdNum) && cardStatusIdNum === statusIdNum;
        
        // Додаткове логування для діагностики (тільки для першої картки першої сторінки)
        if (process.env.NODE_ENV !== 'production' && page === 1 && data.indexOf(card) === 0) {
          console.log('[campaign-stats] Filter check (first card):', {
            cardId: card?.id,
            cardPipelineId,
            cardPipelineIdNum,
            cardStatusId,
            cardStatusIdNum,
            expectedPipeline: pipelineIdNum,
            expectedStatus: statusIdNum,
            pipelineMatch,
            statusMatch,
            cardKeys: Object.keys(card).slice(0, 20), // перші 20 ключів для діагностики
            cardSample: {
              pipeline_id: card?.pipeline_id,
              status_id: card?.status_id,
              pipeline: card?.pipeline,
              status: card?.status,
            },
          });
        }
        
        return pipelineMatch && statusMatch;
      });

      total += filteredData.length;

      // Логування для діагностики (тільки в dev режимі)
      if (process.env.NODE_ENV !== 'production' && page === 1) {
        console.log('[campaign-stats] First page result:', { 
          rawCards: data.length,
          filteredCards: filteredData.length,
          totalSoFar: total,
          hasData: filteredData.length > 0,
          sampleCard: filteredData[0] ? { 
            id: filteredData[0].id, 
            pipeline_id: filteredData[0].pipeline_id ?? filteredData[0].pipeline?.id,
            status_id: filteredData[0].status_id ?? filteredData[0].status?.id
          } : null,
          expectedPipeline: pipelineIdNum,
          expectedStatus: statusIdNum,
          // Додаткова інформація про перші 3 картки (якщо є)
          firstThreeCards: data.slice(0, 3).map((card: any) => ({
            id: card?.id,
            pipeline_id: card?.pipeline_id,
            status_id: card?.status_id,
            pipeline: card?.pipeline,
            status: card?.status,
          })),
        });
      }

      // Перевіряємо, чи є наступна сторінка
      const hasNext = json?.links?.next || json?.next_page_url || 
        (json?.meta?.current_page ?? json?.current_page ?? page) < (json?.meta?.last_page ?? json?.last_page ?? page);
      if (!hasNext) break;
    }
  } catch (err) {
    // Якщо помилка - повертаємо 0 або логуємо
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[campaign-stats] Failed to count cards:', err);
    }
    return 0;
  }

  return total;
}

/**
 * Оновлює статистику базової воронки для кампанії
 */
export async function updateCampaignBaseCardsCount(campaignId: string): Promise<number | null> {
  try {
    // Спробуємо різні ключі, бо кампанії можуть зберігатись під різними ключами
    const keysToTry = [
      campaignKeys.ITEM_KEY(campaignId),      // campaign:${id}
      campaignKeys.CMP_ITEM_KEY(campaignId),  // cmp:item:${id}
      campaignKeys.LEGACY_ITEM_KEY(campaignId), // campaigns:${id}
    ];
    
    // Спочатку спробуємо через @vercel/kv (як в адмін-панелі)
    let campaign: any = null;
    let itemKey: string | null = null;
    
    for (const key of keysToTry) {
      try {
        campaign = await kv.get(key);
        if (campaign) {
          itemKey = key;
          break;
        }
      } catch {
        // Ігноруємо помилки
      }
    }
    
    // Якщо не знайшли через @vercel/kv, спробуємо через kvRead.getRaw
    if (!campaign) {
      let raw: string | null = null;
      for (const key of keysToTry) {
        raw = await kvRead.getRaw(key);
        if (raw) {
          itemKey = key;
          break;
        }
      }

      if (!raw || !itemKey) {
        return null;
      }

      // Парсимо кампанію, можливо вона обгорнута в {value: {...}}
      // kvGetRaw вже намагається розгорнути, але іноді повертає обгортку
    try {
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }

      // Якщо це об'єкт з ключем value, розгортаємо
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if ('value' in parsed) {
          const unwrapped = parsed.value;
          if (typeof unwrapped === 'string') {
            try {
              campaign = JSON.parse(unwrapped);
            } catch {
              campaign = unwrapped;
            }
          } else if (unwrapped && typeof unwrapped === 'object') {
            campaign = unwrapped;
          } else {
            campaign = parsed;
          }
        } else if ('result' in parsed) {
          campaign = parsed.result;
        } else if ('data' in parsed) {
          campaign = parsed.data;
        } else {
          // Перевіряємо, чи це вже кампанія (має поля id, name, base тощо)
          if ('id' in parsed || 'name' in parsed || 'base' in parsed) {
            campaign = parsed;
          } else {
            campaign = parsed;
          }
        }
      } else {
        campaign = parsed;
      }

      // Якщо все ще рядок, спробуємо розпарсити ще раз
      if (typeof campaign === 'string') {
        try {
          campaign = JSON.parse(campaign);
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }

      if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
        return null;
      }
    }

    if (!campaign) {
      return null;
    }
    
    // Отримуємо базову воронку (перевіряємо всі можливі місця)
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

    if (!basePipelineId || !baseStatusId) {
      return null;
    }

    // Підраховуємо картки
    const count = await countCardsInBasePipeline(basePipelineId, baseStatusId);
    
    // Логування для діагностики (тільки в dev режимі)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[campaign-stats] Updating campaign stats:', {
        campaignId,
        basePipelineId,
        baseStatusId,
        oldCount: campaign.baseCardsCount,
        newCount: count,
        movedTotal,
        baseCardsTotalPassed: count + movedTotal,
        itemKey,
      });
    }

    // Зберігаємо початкову кількість, якщо її ще немає (для старих кампаній)
    if (typeof campaign.baseCardsCountInitial !== 'number') {
      campaign.baseCardsCountInitial = count;
    }
    
    // Ініціалізуємо baseCardsTotalPassed, якщо його ще немає (для старих кампаній)
    if (typeof campaign.baseCardsTotalPassed !== 'number') {
      campaign.baseCardsTotalPassed = campaign.baseCardsCountInitial || 0;
    }
    
    // Обчислюємо переміщені картки ДО оновлення baseCardsCount
    const v1Count = typeof campaign.counters?.v1 === 'number' ? campaign.counters.v1 : campaign.v1_count || 0;
    const v2Count = typeof campaign.counters?.v2 === 'number' ? campaign.counters.v2 : campaign.v2_count || 0;
    const expCount = typeof campaign.counters?.exp === 'number' ? campaign.counters.exp : campaign.exp_count || 0;
    const movedTotal = v1Count + v2Count + expCount;
    
    // Оновлюємо кампанію
    const oldCount = typeof campaign.baseCardsCount === 'number' ? campaign.baseCardsCount : campaign.baseCardsCountInitial || 0;
    campaign.baseCardsCount = count;
    campaign.baseCardsCountUpdatedAt = Date.now();
    
    // Обчислюємо загальну кількість карток, яка була додана до статусу
    // baseCardsTotalPassed = поточна кількість + переміщені картки
    // Це відображає загальну кількість карток, яка була в статусі
    // (поточна кількість карток, які зараз в статусі + переміщені картки)
    const currentTotal = count + movedTotal;
    campaign.baseCardsTotalPassed = currentTotal;


    campaign.movedTotal = v1Count + v2Count + expCount;
    campaign.movedV1 = v1Count;
    campaign.movedV2 = v2Count;
    campaign.movedExp = expCount;

    // Зберігаємо оновлену кампанію через @vercel/kv (якщо використовували @vercel/kv для читання)
    // або через kvWrite.setRaw (якщо використовували kvRead.getRaw для читання)
    if (itemKey) {
      try {
        // Спробуємо зберегти через @vercel/kv
        await kv.set(itemKey, campaign);
      } catch {
        // Якщо не вдалося через @vercel/kv, використовуємо kvWrite.setRaw
        await kvWrite.setRaw(itemKey, JSON.stringify(campaign));
      }
    } else {
      // Якщо не знайшли itemKey, спробуємо зберегти під всіма можливими ключами
      for (const key of keysToTry) {
        try {
          await kv.set(key, campaign);
          break;
        } catch {
          try {
            await kvWrite.setRaw(key, JSON.stringify(campaign));
            break;
          } catch {
            // Продовжуємо наступний ключ
          }
        }
      }
    }

    return count;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[campaign-stats] Failed to update base cards count:', err);
    }
    return null;
  }
}

/**
 * Ініціалізує статистику для нової кампанії
 */
export async function initializeCampaignStats(campaign: any): Promise<any> {
  // Перевіряємо всі можливі місця, де може бути збережений pipeline_id/status_id
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

  // Логування для діагностики (тільки в dev режимі)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[campaign-stats] Initializing stats:', {
      campaignId: campaign.id,
      basePipelineId,
      baseStatusId,
      base: campaign.base,
    });
  }

  if (!basePipelineId || !baseStatusId) {
    return {
      ...campaign,
      baseCardsCount: 0,
      baseCardsCountInitial: 0, // Початкова кількість при створенні
      baseCardsTotalPassed: 0, // При створенні кампанії загальна кількість = початкова кількість
      baseCardsCountUpdatedAt: Date.now(),
      movedTotal: 0,
      movedV1: 0,
      movedV2: 0,
      movedExp: 0,
    };
  }

  const count = await countCardsInBasePipeline(basePipelineId, baseStatusId);
  
  // Логування для діагностики (тільки в dev режимі)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[campaign-stats] Count result:', { campaignId: campaign.id, count, basePipelineId, baseStatusId });
  }

  const v1Count = campaign.counters?.v1 || campaign.v1_count || 0;
  const v2Count = campaign.counters?.v2 || campaign.v2_count || 0;
  const expCount = campaign.counters?.exp || campaign.exp_count || 0;

  return {
    ...campaign,
    baseCardsCount: count,
    baseCardsCountInitial: count, // Зберігаємо початкову кількість для обчислення загальної
    baseCardsTotalPassed: count, // При створенні кампанії загальна кількість = початкова кількість
    baseCardsCountUpdatedAt: Date.now(),
    movedTotal: v1Count + v2Count + expCount,
    movedV1: v1Count,
    movedV2: v2Count,
    movedExp: expCount,
  };
}

