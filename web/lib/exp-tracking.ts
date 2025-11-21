// web/lib/exp-tracking.ts
// Функції для відстеження часу перебування карток у базовій воронці для механізму EXP

import { expTrackingKeys, kvRead, kvWrite } from '@/lib/kv';

export type ExpTrackingRecord = {
  timestamp: number; // коли переміщено в базову воронку (epoch ms)
  campaignId: string;
  cardId: string;
  basePipelineId: number | null;
  baseStatusId: number | null;
};

/**
 * Зберігає timestamp переміщення картки в базову воронку
 * Викликається тільки для кампаній з EXP
 */
export async function saveExpTracking(
  campaignId: string,
  cardId: string,
  basePipelineId: number | null,
  baseStatusId: number | null
): Promise<void> {
  try {
    const key = expTrackingKeys.TRACK_KEY(campaignId, cardId);
    const record: ExpTrackingRecord = {
      timestamp: Date.now(),
      campaignId,
      cardId,
      basePipelineId,
      baseStatusId,
    };
    await kvWrite.setRaw(key, JSON.stringify(record));
  } catch (err) {
    // Ігноруємо помилки збереження - не критично для роботи системи
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[exp-tracking] Failed to save tracking:', err);
    }
  }
}

/**
 * Отримує timestamp переміщення картки в базову воронку
 */
export async function getExpTracking(
  campaignId: string,
  cardId: string
): Promise<ExpTrackingRecord | null> {
  try {
    const key = expTrackingKeys.TRACK_KEY(campaignId, cardId);
    const raw = await kvRead.getRaw(key);
    if (!raw) return null;
    
    const record = JSON.parse(raw) as ExpTrackingRecord;
    // Валідація структури
    if (typeof record.timestamp === 'number' && record.campaignId && record.cardId) {
      return record;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Видаляє tracking запис (після переміщення в цільову воронку EXP)
 */
export async function deleteExpTracking(
  campaignId: string,
  cardId: string
): Promise<void> {
  try {
    const key = expTrackingKeys.TRACK_KEY(campaignId, cardId);
    // Видаляємо через setRaw з порожнім значенням або через окремий метод
    // Залежить від реалізації KV - поки що просто ігноруємо помилки
    await kvWrite.setRaw(key, '').catch(() => {});
  } catch {
    // Ігноруємо помилки видалення
  }
}

/**
 * Отримує timestamp з KeyCRM картки (fallback для карток, переміщених вручну)
 * Використовується, коли картка була переміщена в базову воронку безпосередньо в KeyCRM,
 * а не через автоматичний механізм v1/v2
 * Шукає updated_at, updatedAt, created_at, createdAt
 */
export function extractTimestampFromKeycrmCard(card: any): number | null {
  if (!card || typeof card !== 'object') return null;
  
  // Перевіряємо різні варіанти назв полів
  const timestampFields = [
    'updated_at',
    'updatedAt',
    'updated',
    'created_at',
    'createdAt',
    'created',
  ];
  
  for (const field of timestampFields) {
    const value = card[field];
    if (value == null) continue;
    
    // Якщо це число (timestamp в мс або секундах)
    if (typeof value === 'number') {
      // Якщо менше 1e12, то це секунди - конвертуємо в мс
      return value < 1e12 ? value * 1000 : value;
    }
    
    // Якщо це рядок (ISO date або інший формат)
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  }
  
  return null;
}

