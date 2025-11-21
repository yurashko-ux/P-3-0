// web/lib/campaign-uniqueness.ts
// Функції для перевірки унікальності V1/V2 при створенні/редагуванні кампаній

import { kvRead } from './kv';

/**
 * Нормалізує значення V1/V2 для порівняння
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).toLowerCase().trim() || null;
}

/**
 * Перевіряє, чи унікальні значення V1 та V2 серед усіх збережених кампаній
 * 
 * Правила унікальності:
 * - Якщо в будь-якій кампанії є V1="1", то жодна інша кампанія не може мати V1="1" або V2="1"
 * - Якщо в будь-якій кампанії є V2="1", то жодна інша кампанія не може мати V1="1" або V2="1"
 * 
 * @param v1 - значення V1 для перевірки
 * @param v2 - значення V2 для перевірки
 * @param excludeCampaignId - ID кампанії, яку треба виключити з перевірки (для редагування)
 * @returns null якщо унікальні, або об'єкт з помилкою
 */
export async function checkCampaignVUniqueness(
  v1: string | null | undefined,
  v2: string | null | undefined,
  excludeCampaignId?: string
): Promise<{ ok: false; error: string; conflictingValue: string; conflictingCampaign: { id: string; name: string } } | null> {
  const normalizedV1 = normalizeValue(v1);
  const normalizedV2 = normalizeValue(v2);

  // Якщо обидва значення порожні - перевірка не потрібна
  if (!normalizedV1 && !normalizedV2) {
    return null;
  }

  // Отримуємо всі кампанії
  const allCampaigns = await kvRead.listCampaigns<any>();

  // Перевіряємо кожну кампанію на конфлікти
  for (const campaign of allCampaigns) {
    // Пропускаємо поточну кампанію (якщо редагуємо)
    if (excludeCampaignId && campaign.id === excludeCampaignId) {
      continue;
    }

    // Отримуємо значення V1/V2 з кампанії
    // Можуть бути в різних форматах: v1, rules.v1.value, тощо
    const campaignV1 = normalizeValue(
      campaign.v1 ?? 
      campaign.rules?.v1?.value ?? 
      campaign.rules?.V1?.value ?? 
      campaign.rules?.variant1?.value
    );
    
    const campaignV2 = normalizeValue(
      campaign.v2 ?? 
      campaign.rules?.v2?.value ?? 
      campaign.rules?.V2?.value ?? 
      campaign.rules?.variant2?.value
    );

    // Перевіряємо конфлікти з нормалізованим V1
    if (normalizedV1) {
      // Якщо у існуючої кампанії є такий самий V1 - конфлікт
      if (campaignV1 === normalizedV1) {
        return {
          ok: false,
          error: `Значення V1 "${v1}" вже використовується в кампанії "${campaign.name || campaign.id}"`,
          conflictingValue: normalizedV1,
          conflictingCampaign: {
            id: campaign.id,
            name: campaign.name || 'Без назви',
          },
        };
      }

      // Якщо у існуючої кампанії є такий самий V2 - конфлікт
      if (campaignV2 === normalizedV1) {
        return {
          ok: false,
          error: `Значення V1 "${v1}" конфліктує з V2 в кампанії "${campaign.name || campaign.id}"`,
          conflictingValue: normalizedV1,
          conflictingCampaign: {
            id: campaign.id,
            name: campaign.name || 'Без назви',
          },
        };
      }
    }

    // Перевіряємо конфлікти з нормалізованим V2
    if (normalizedV2) {
      // Якщо у існуючої кампанії є такий самий V2 - конфлікт
      if (campaignV2 === normalizedV2) {
        return {
          ok: false,
          error: `Значення V2 "${v2}" вже використовується в кампанії "${campaign.name || campaign.id}"`,
          conflictingValue: normalizedV2,
          conflictingCampaign: {
            id: campaign.id,
            name: campaign.name || 'Без назви',
          },
        };
      }

      // Якщо у існуючої кампанії є такий самий V1 - конфлікт
      if (campaignV1 === normalizedV2) {
        return {
          ok: false,
          error: `Значення V2 "${v2}" конфліктує з V1 в кампанії "${campaign.name || campaign.id}"`,
          conflictingValue: normalizedV2,
          conflictingCampaign: {
            id: campaign.id,
            name: campaign.name || 'Без назви',
          },
        };
      }
    }
  }

  // Конфліктів не знайдено
  return null;
}

