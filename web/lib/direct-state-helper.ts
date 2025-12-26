// web/lib/direct-state-helper.ts
// Допоміжні функції для визначення стану клієнта на основі послуг

/**
 * Визначає стан клієнта на основі послуг з запису
 * Пріоритет:
 * 1. "Консультація" - якщо є послуга "Консультація"
 * 2. "Нарощування волосся" - якщо є послуга з "Нарощування волосся" (навіть якщо є інші послуги)
 * 3. "Інші послуги" - якщо є інші платні послуги (крім нарощування)
 * 4. null - якщо немає відповідних послуг
 */
export function determineStateFromServices(services: any[]): 'consultation' | 'hair-extension' | 'other-services' | null {
  if (!Array.isArray(services) || services.length === 0) {
    return null;
  }

  // Перевіряємо, чи є послуга "Консультація"
  const hasConsultation = services.some((s: any) => 
    s.title && /консультація/i.test(s.title)
  );

  if (hasConsultation) {
    return 'consultation';
  }

  // Перевіряємо, чи є послуга з "Нарощування волосся"
  // Нарощування має пріоритет, навіть якщо є інші послуги
  const hasHairExtension = services.some((s: any) => 
    s.title && /нарощування.*волосся/i.test(s.title)
  );

  if (hasHairExtension) {
    return 'hair-extension';
  }

  // Перевіряємо, чи є інші платні послуги (не консультація, не нарощування)
  // Послуга вважається платною, якщо cost > 0 або якщо немає поля cost (припускаємо, що це платна послуга)
  const hasOtherPaidServices = services.some((s: any) => {
    if (!s.title) return false;
    
    // Пропускаємо консультацію та нарощування
    if (/консультація/i.test(s.title)) return false;
    if (/нарощування.*волосся/i.test(s.title)) return false;
    
    // Перевіряємо, чи це платна послуга
    const cost = s.cost || s.cost_to_pay || s.manual_cost || 0;
    return cost > 0;
  });

  if (hasOtherPaidServices) {
    return 'other-services';
  }

  return null;
}

/**
 * Визначає стан клієнта на основі останнього запису з altegio:records:log
 * Повертає стан або null, якщо записів немає
 */
export async function determineStateFromRecordsLog(
  altegioClientId: number,
  kvRead: any
): Promise<'consultation' | 'hair-extension' | 'other-services' | 'client' | null> {
  try {
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    const clientRecords = recordsLogRaw
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return null;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId === altegioClientId && r.data && Array.isArray(r.data.services))
      .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

    // Беремо останній запис для визначення стану
    if (clientRecords.length > 0) {
      const latestRecord = clientRecords[0];
      const services = latestRecord.data.services || [];
      const determinedState = determineStateFromServices(services);
      
      // Якщо визначили стан - повертаємо його, інакше повертаємо 'client'
      return determinedState || 'client';
    }

    // Якщо записів немає, повертаємо 'client' (клієнт є в Altegio, але немає записів)
    return 'client';
  } catch (err) {
    console.warn(`[direct-state-helper] Failed to check records for client ${altegioClientId}:`, err);
    // У разі помилки повертаємо 'client'
    return 'client';
  }
}
