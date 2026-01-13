// web/app/api/cron/sync-paid-service-dates/route.ts
// Автоматична синхронізація paidServiceDate, consultationBookingDate та станів зі старих вебхуків
// для клієнтів, які з'явилися пізніше
// Запускається автоматично раз на годину

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { saveDirectClient, getAllDirectClients } from '@/lib/direct-store';
import { determineStateFromServices } from '@/lib/direct-state-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Перевіряє, чи це консультація
 */
function isConsultationService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) {
    return false;
  }
  
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    return /консультаці/i.test(title);
  });
}

/**
 * Перевіряє, чи є платна послуга (не консультація)
 */
function hasPaidService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) {
    return false;
  }
  
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    if (/консультаці/i.test(title)) {
      return false;
    }
    return true;
  });
}

/**
 * Рекурсивно розгортає KV відповідь
 */
function unwrapKVResponse(data: any): any {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && 'value' in parsed) {
        return unwrapKVResponse(parsed.value);
      }
      return parsed;
    } catch {
      return data;
    }
  }
  if (data && typeof data === 'object' && 'value' in data) {
    return unwrapKVResponse(data.value);
  }
  return data;
}

/**
 * GET/POST - викликається cron job для автоматичної синхронізації paidServiceDate
 */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  try {
    // Перевірка авторизації через CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    const secretParam = req.nextUrl.searchParams.get('secret');
    
    if (cronSecret) {
      const isAuthorized = 
        authHeader === `Bearer ${cronSecret}` ||
        secretParam === cronSecret;
      
      if (!isAuthorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log('[cron/sync-paid-service-dates] Starting automatic paidServiceDate sync...');

    // Отримуємо всіх клієнтів з Direct Manager
    const allClients = await getAllDirectClients();
    console.log(`[cron/sync-paid-service-dates] Found ${allClients.length} clients in Direct Manager`);

    // Фільтруємо клієнтів, які мають altegioClientId, але не мають paidServiceDate або consultationBookingDate
    // або мають стан 'client' (потрібно оновити стан)
    const clientsToCheck = allClients.filter(
      (c) => c.altegioClientId && (
        !c.paidServiceDate || 
        !c.consultationBookingDate || 
        c.state === 'client' || 
        c.state === 'lead'
      )
    );
    console.log(`[cron/sync-paid-service-dates] Found ${clientsToCheck.length} clients that need sync (missing dates or need state update)`);

    if (clientsToCheck.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No clients need sync',
        stats: {
          totalClients: allClients.length,
          checked: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Отримуємо всі записи з records:log
    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[cron/sync-paid-service-dates] Found ${rawItems.length} records in records:log`);

    // Парсимо записи
    const records = rawItems
      .map((raw) => {
        try {
          const parsed = unwrapKVResponse(raw);
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId && r.datetime && r.data && Array.isArray(r.data.services));

    console.log(`[cron/sync-paid-service-dates] Parsed ${records.length} valid records`);

    // Створюємо мапи: clientId -> найновіша дата та послуги
    const clientPaidServiceDates = new Map<number, { datetime: string; services: any[] }>();
    const clientConsultationDates = new Map<number, { datetime: string; services: any[]; attendance?: number }>();
    const clientStates = new Map<number, { state: string | null; datetime: string; services: any[] }>();

    for (const record of records) {
      const clientId = parseInt(String(record.clientId), 10);
      if (isNaN(clientId)) continue;

      const services = record.data.services || [];
      if (services.length === 0) continue;

      const datetime = record.datetime || record.data?.datetime;
      if (!datetime) continue;

      const attendance = record.attendance || record.data?.attendance || record.visit_attendance;
      const recordDate = new Date(datetime);

      // Визначаємо стан на основі послуг
      const determinedState = determineStateFromServices(services);
      
      // Оновлюємо стан (беремо найновіший запис)
      const existingState = clientStates.get(clientId);
      if (!existingState || new Date(existingState.datetime) < recordDate) {
        clientStates.set(clientId, { 
          state: determinedState, 
          datetime, 
          services 
        });
      }

      // Для консультацій
      if (isConsultationService(services)) {
        const existing = clientConsultationDates.get(clientId);
        if (!existing || new Date(existing.datetime) < recordDate) {
          clientConsultationDates.set(clientId, { datetime, services, attendance });
        }
      }
      // Для платних послуг (не консультації)
      else if (hasPaidService(services)) {
        const existing = clientPaidServiceDates.get(clientId);
        if (!existing || new Date(existing.datetime) < recordDate) {
          clientPaidServiceDates.set(clientId, { datetime, services });
        }
      }
    }

    console.log(`[cron/sync-paid-service-dates] Found: ${clientPaidServiceDates.size} paid services, ${clientConsultationDates.size} consultations, ${clientStates.size} states`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Оновлюємо клієнтів
    for (const client of clientsToCheck) {
      if (!client.altegioClientId) {
        skippedCount++;
        continue;
      }

      const paidServiceInfo = clientPaidServiceDates.get(client.altegioClientId);
      const consultationInfo = clientConsultationDates.get(client.altegioClientId);
      const stateInfo = clientStates.get(client.altegioClientId);

      // Якщо немає жодної інформації - пропускаємо
      if (!paidServiceInfo && !consultationInfo && !stateInfo) {
        skippedCount++;
        continue;
      }

      try {
        const updates: Partial<typeof client> = {
          updatedAt: new Date().toISOString(),
        };

        // Оновлюємо consultationBookingDate
        if (consultationInfo && (!client.consultationBookingDate || new Date(client.consultationBookingDate) < new Date(consultationInfo.datetime))) {
          updates.consultationBookingDate = consultationInfo.datetime;
          updates.consultationAttended = consultationInfo.attendance === 1 ? true : (consultationInfo.attendance === -1 ? false : undefined);
        }

        // Оновлюємо paidServiceDate (тільки якщо немає консультації або консультація вже пройшла)
        if (paidServiceInfo) {
          const shouldSetPaidService = !consultationInfo || 
            (client.consultationBookingDate && new Date(client.consultationBookingDate) < new Date(paidServiceInfo.datetime));
          
          if (shouldSetPaidService && (!client.paidServiceDate || new Date(client.paidServiceDate) < new Date(paidServiceInfo.datetime))) {
            updates.paidServiceDate = paidServiceInfo.datetime;
            updates.signedUpForPaidService = true;
          }
        }

        // Оновлюємо стан (якщо потрібно)
        if (stateInfo && stateInfo.state) {
          // Визначаємо фінальний стан
          let finalState = stateInfo.state;
          
          // Якщо є консультація і клієнт не прийшов - встановлюємо consultation-booked
          if (consultationInfo && consultationInfo.attendance !== 1) {
            finalState = 'consultation-booked';
          }
          // Якщо є консультація і клієнт прийшов - встановлюємо consultation
          else if (consultationInfo && consultationInfo.attendance === 1) {
            finalState = 'consultation';
          }
          // Якщо є нарощування - встановлюємо hair-extension
          else if (finalState === 'hair-extension') {
            finalState = 'hair-extension';
          }
          // Якщо є інші послуги - встановлюємо other-services
          else if (finalState === 'other-services') {
            finalState = 'other-services';
          }
          // Якщо визначили consultation - встановлюємо consultation
          else if (finalState === 'consultation') {
            finalState = 'consultation';
          }

          // Оновлюємо стан тільки якщо він відрізняється від поточного
          if (finalState && client.state !== finalState && (client.state === 'client' || client.state === 'lead' || !client.state)) {
            updates.state = finalState as any;
          }
        }

        // Якщо є зміни - зберігаємо
        if (Object.keys(updates).length > 1) { // Більше 1, бо завжди є updatedAt
          const updated: typeof client = {
            ...client,
            ...updates,
          };

          await saveDirectClient(updated, 'cron-sync-from-old-webhooks', {
            altegioClientId: client.altegioClientId,
            paidServiceDate: paidServiceInfo?.datetime,
            consultationBookingDate: consultationInfo?.datetime,
            newState: updates.state,
            oldState: client.state,
            services: stateInfo?.services?.map((s: any) => ({ id: s.id, title: s.title })) || [],
            reason: 'Auto-synced from old webhooks',
          });

          updatedCount++;
          const changes = [];
          if (updates.paidServiceDate) changes.push(`paidServiceDate: ${updates.paidServiceDate}`);
          if (updates.consultationBookingDate) changes.push(`consultationBookingDate: ${updates.consultationBookingDate}`);
          if (updates.state) changes.push(`state: ${client.state} -> ${updates.state}`);
          console.log(`[cron/sync-paid-service-dates] ✅ Updated client ${client.id} (${client.instagramUsername}): ${changes.join(', ')}`);
        } else {
          skippedCount++;
        }
      } catch (err) {
        const errorMsg = `Failed to update client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[cron/sync-paid-service-dates] ❌ ${errorMsg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Automatic sync completed (paidServiceDate, consultationBookingDate, states)',
      stats: {
        totalClients: allClients.length,
        checked: clientsToCheck.length,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 10) : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron/sync-paid-service-dates] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
