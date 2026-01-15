// web/app/api/cron/sync-paid-service-dates/route.ts
// Автоматична синхронізація paidServiceDate, consultationBookingDate та станів зі старих вебхуків
// для клієнтів, які з'явилися пізніше
// Запускається автоматично раз на годину

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { saveDirectClient, getAllDirectClients } from '@/lib/direct-store';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { groupRecordsByClientDay, normalizeRecordsLogItems, isAdminStaffName } from '@/lib/altegio/records-grouping';

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

    const normalizedEvents = normalizeRecordsLogItems(rawItems);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);
    console.log(`[cron/sync-paid-service-dates] Normalized ${normalizedEvents.length} events, groups for ${groupsByClient.size} clients`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Оновлюємо клієнтів
    for (const client of clientsToCheck) {
      if (!client.altegioClientId) {
        skippedCount++;
        continue;
      }

      const groups = groupsByClient.get(client.altegioClientId) || [];
      const paidGroups = groups.filter((g) => g.groupType === 'paid');
      const consultationGroups = groups.filter((g) => g.groupType === 'consultation');
      const paidServiceInfo = paidGroups[0] || null;
      const consultationInfo = consultationGroups[0] || null;

      // Якщо немає жодної інформації - пропускаємо
      if (!paidServiceInfo && !consultationInfo) {
        skippedCount++;
        continue;
      }

      try {
        const updates: Partial<typeof client> = {
          updatedAt: new Date().toISOString(),
        };

        // Консультація: дата + attendance (✅/❌/🚫) + "Консультував"
        if (consultationInfo && consultationInfo.datetime) {
          if (!client.consultationBookingDate || new Date(client.consultationBookingDate) < new Date(consultationInfo.datetime)) {
            updates.consultationBookingDate = consultationInfo.datetime;
          }

          // attendance: не перезаписуємо true на false/null
          if (consultationInfo.attendanceStatus === 'arrived') {
            updates.consultationAttended = true;
            updates.consultationCancelled = false;
          } else if (consultationInfo.attendanceStatus === 'no-show') {
            if (client.consultationAttended !== true) {
              updates.consultationAttended = false;
            }
            updates.consultationCancelled = false;
          } else if (consultationInfo.attendanceStatus === 'cancelled') {
            if (client.consultationAttended !== true) {
              updates.consultationAttended = null;
            }
            updates.consultationCancelled = true;
          } else {
            updates.consultationCancelled = false;
          }

          // "Консультував": беремо останній event з НЕ-адміністратором
          const lastNonAdmin = [...(consultationInfo.events || [])]
            .sort((a: any, b: any) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
            .find((ev: any) => {
              const name = (ev.staffName || '').toString().trim();
              if (!name) return false;
              if (name.toLowerCase().includes('невідом')) return false;
              return !isAdminStaffName(name);
            });

          if (lastNonAdmin?.staffName) {
            updates.consultationMasterName = lastNonAdmin.staffName;
            try {
              const { getMasterByName } = await import('@/lib/direct-masters/store');
              const m = await getMasterByName(lastNonAdmin.staffName);
              if (m) updates.consultationMasterId = m.id;
            } catch (err) {
              console.warn('[cron/sync-paid-service-dates] ⚠️ Не вдалося знайти майстра по імені для консультації:', err);
            }
          }
        }

        // Платні послуги: дата + attendance (✅/❌/🚫)
        if (paidServiceInfo && paidServiceInfo.datetime) {
          if (!client.paidServiceDate || new Date(client.paidServiceDate) < new Date(paidServiceInfo.datetime)) {
            updates.paidServiceDate = paidServiceInfo.datetime;
            updates.signedUpForPaidService = true;
          }

          if (paidServiceInfo.attendanceStatus === 'arrived') {
            updates.paidServiceAttended = true;
            updates.paidServiceCancelled = false;
          } else if (paidServiceInfo.attendanceStatus === 'no-show') {
            if (client.paidServiceAttended !== true) {
              updates.paidServiceAttended = false;
            }
            updates.paidServiceCancelled = false;
          } else if (paidServiceInfo.attendanceStatus === 'cancelled') {
            if (client.paidServiceAttended !== true) {
              updates.paidServiceAttended = null;
            }
            updates.paidServiceCancelled = true;
          } else {
            updates.paidServiceCancelled = false;
          }
        }

        // Оновлюємо стан по групі (paid має пріоритет над consultation)
        const chosenForState = paidServiceInfo || consultationInfo;
        if (chosenForState) {
          let finalState: string | null = null;
          if (chosenForState.groupType === 'consultation') {
            finalState = consultationInfo?.attendanceStatus === 'arrived' ? 'consultation' : 'consultation-booked';
          } else {
            finalState = determineStateFromServices(chosenForState.services) || 'other-services';
          }

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
            paidServiceDate: paidServiceInfo?.datetime || null,
            consultationBookingDate: consultationInfo?.datetime || null,
            newState: updates.state,
            oldState: client.state,
            services: (paidServiceInfo?.services || consultationInfo?.services || []).map((s: any) => ({ id: s.id, title: s.title || s.name })) || [],
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
