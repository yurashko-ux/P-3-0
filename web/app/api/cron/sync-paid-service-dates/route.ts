// web/app/api/cron/sync-paid-service-dates/route.ts
// Автоматична синхронізація paidServiceDate, consultationBookingDate та станів зі старих вебхуків
// для клієнтів, які з'явилися пізніше
// Запускається автоматично раз на годину

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import { saveDirectClient, getAllDirectClients } from '@/lib/direct-store';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { groupRecordsByClientDay, normalizeRecordsLogItems, isAdminStaffName, pickNonAdminStaffFromGroup, appendServiceMasterHistory, computeServicesTotalCostUAH, kyivDayFromISO } from '@/lib/altegio/records-grouping';

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
    const isVercelCron = req.headers.get('x-vercel-cron') === '1';
    
    if (cronSecret) {
      const isAuthorized = 
        isVercelCron ||
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
        c.state === 'client'
      )
    );
    // Клієнти з обома датами — синхронізуємо лише paidServiceAttended/paidServiceCancelled (для крапочки)
    const clientsForAttendanceOnly = allClients.filter(
      (c) => c.altegioClientId && c.paidServiceDate && c.consultationBookingDate && c.state !== 'client'
    );
    console.log(`[cron/sync-paid-service-dates] Found ${clientsToCheck.length} clients for dates/state sync, ${clientsForAttendanceOnly.length} for attendance-only sync`);

    if (clientsToCheck.length === 0 && clientsForAttendanceOnly.length === 0) {
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
        // Не перезаписувати, якщо консультацію позначено як видалену в Altegio (404)
        if (consultationInfo && consultationInfo.datetime && !(client as any).consultationDeletedInAltegio) {
          if (!client.consultationBookingDate || new Date(client.consultationBookingDate) < new Date(consultationInfo.datetime)) {
            updates.consultationBookingDate = consultationInfo.datetime;
            (updates as any).consultationDeletedInAltegio = false;
          }

          // attendance: не перезаписуємо true на false/null
          if (consultationInfo.attendanceStatus === 'arrived') {
            updates.consultationAttended = true;
            updates.consultationCancelled = false;
            if (consultationInfo.attendance === 1 || consultationInfo.attendance === 2) {
              (updates as any).consultationAttendanceValue = consultationInfo.attendance;
            }
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

          // "Хто консультував":
          // - бізнес-правило: показуємо МАЙСТРА (не-адміна), якщо він є
          // - fallback: якщо в групі тільки адмін — показуємо адміна (щоб не було порожньо)
          // - завжди беремо ОСТАННІЙ webhook (latest by receivedAt)
          const sortedConsultationEvents = [...(consultationInfo.events || [])].sort((a: any, b: any) => {
            const ta = new Date(b?.receivedAt || b?.datetime || 0).getTime();
            const tb = new Date(a?.receivedAt || a?.datetime || 0).getTime();
            return ta - tb;
          });

          const isKnownName = (ev: any) => {
            const name = (ev?.staffName || '').toString().trim();
            if (!name) return false;
            if (name.toLowerCase().includes('невідом')) return false;
            return true;
          };

          const lastNonAdmin = sortedConsultationEvents.find((ev: any) => {
            if (!isKnownName(ev)) return false;
            return !isAdminStaffName((ev.staffName || '').toString());
          });

          const lastAdmin = sortedConsultationEvents.find((ev: any) => {
            if (!isKnownName(ev)) return false;
            return isAdminStaffName((ev.staffName || '').toString());
          });

          const chosenConsultant = lastNonAdmin || lastAdmin || null;
          if (chosenConsultant?.staffName) {
            updates.consultationMasterName = chosenConsultant.staffName;
            (updates as any).consultationDeletedInAltegio = false;
            try {
              const { getMasterByName } = await import('@/lib/direct-masters/store');
              const m = await getMasterByName(chosenConsultant.staffName);
              if (m) updates.consultationMasterId = m.id;
            } catch (err) {
              console.warn('[cron/sync-paid-service-dates] ⚠️ Не вдалося знайти майстра по імені для консультації:', err);
            }
          }

          // "Майстер" (загальний): для консультації теж виставляємо поточного майстра
          const picked = pickNonAdminStaffFromGroup(consultationInfo, 'latest');
          // Додаткова перевірка: не встановлюємо адміністраторів
          if (picked?.staffName && !isAdminStaffName(picked.staffName)) {
            // Додаткова перевірка ролі в БД (якщо доступна)
            try {
              const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
              const masters = await getAllDirectMasters();
              const masterNameToRole = new Map(masters.map((m: any) => [m.name?.toLowerCase().trim() || '', m.role || 'master']));
              const staffNameLower = picked.staffName.toLowerCase().trim();
              const role = masterNameToRole.get(staffNameLower);
              const isAdminByRole = role === 'admin' || role === 'direct-manager';
              if (isAdminByRole) {
                console.log(`[cron/sync-paid-service-dates] ⚠️ Skipping admin ${picked.staffName} (role: ${role}) for consultation master`);
              } else {
                updates.serviceMasterName = picked.staffName;
                updates.serviceMasterAltegioStaffId = picked.staffId ?? null;
                updates.serviceMasterHistory = appendServiceMasterHistory(client.serviceMasterHistory, {
                  kyivDay: consultationInfo.kyivDay,
                  masterName: picked.staffName,
                  source: 'records-group',
                });
              }
            } catch (err) {
              // Якщо не вдалося перевірити роль - використовуємо тільки isAdminStaffName
              if (!isAdminStaffName(picked.staffName)) {
                updates.serviceMasterName = picked.staffName;
                updates.serviceMasterAltegioStaffId = picked.staffId ?? null;
                updates.serviceMasterHistory = appendServiceMasterHistory(client.serviceMasterHistory, {
                  kyivDay: consultationInfo.kyivDay,
                  masterName: picked.staffName,
                  source: 'records-group',
                });
              }
            }
          }
        }

        // Платні послуги: дата + attendance (✅/❌/🚫)
        if (paidServiceInfo && paidServiceInfo.datetime && !(client as any).paidServiceDeletedInAltegio) {
          if (!client.paidServiceDate || new Date(client.paidServiceDate) < new Date(paidServiceInfo.datetime)) {
            updates.paidServiceDate = paidServiceInfo.datetime;
            (updates as any).paidServiceDeletedInAltegio = false;
            updates.signedUpForPaidService = true;
          }

          // Сума платного запису (грн) — підрахунок по services з вебхуків Altegio
          try {
            const total = computeServicesTotalCostUAH(paidServiceInfo.services || []);
            if (total > 0) updates.paidServiceTotalCost = total;
          } catch (err) {
            console.warn('[cron/sync-paid-service-dates] ⚠️ Не вдалося порахувати paidServiceTotalCost:', err);
          }

          if (paidServiceInfo.attendanceStatus === 'arrived') {
            updates.paidServiceAttended = true;
            updates.paidServiceCancelled = false;
            if (paidServiceInfo.attendance === 1 || paidServiceInfo.attendance === 2) {
              (updates as any).paidServiceAttendanceValue = paidServiceInfo.attendance;
            }
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

          // "Майстер" (загальний): беремо майстра з paid-групи (latest non-admin)
          // Бізнес-правило: головний майстер = перший не-адмін за receivedAt (для записів “в 4 руки”).
          const picked = pickNonAdminStaffFromGroup(paidServiceInfo, 'first');
          if (picked?.staffName) {
            updates.serviceMasterName = picked.staffName;
            updates.serviceMasterAltegioStaffId = picked.staffId ?? null;
            updates.serviceMasterHistory = appendServiceMasterHistory(client.serviceMasterHistory, {
              kyivDay: paidServiceInfo.kyivDay,
              masterName: picked.staffName,
              source: 'records-group',
            });
          }
        }

        // Оновлюємо стан по групі (paid має пріоритет над consultation)
        const chosenForState = paidServiceInfo || consultationInfo;
        if (chosenForState) {
          let finalState: string | null = null;
          if (chosenForState.groupType === 'consultation') {
            // НЕ використовуємо стан `consultation` (факт приходу дивимось по ✅ у даті консультації).
            finalState = 'consultation-booked';
          } else {
            finalState = determineStateFromServices(chosenForState.services) || 'other-services';
          }

          if (finalState && client.state !== finalState && (client.state === 'client' || !client.state)) {
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

    // Другий прохід: оновлення paidServiceAttended/paidServiceCancelled для клієнтів з обома датами (крапочка в таблиці)
    for (const client of clientsForAttendanceOnly) {
      if (!client.altegioClientId || !client.paidServiceDate) continue;
      try {
        const groups = groupsByClient.get(client.altegioClientId) || [];
        const paidGroups = groups.filter((g) => g.groupType === 'paid');
        const paidKyivDay = kyivDayFromISO(
          typeof client.paidServiceDate === 'string'
            ? client.paidServiceDate
            : (client.paidServiceDate as Date).toISOString?.() ?? ''
        );
        const paidGroup = paidGroups.find((g) => (g.kyivDay || '') === paidKyivDay) ?? paidGroups[0];
        if (!paidGroup) continue;

        const attStatus = String((paidGroup as any).attendanceStatus || '');
        const attVal = (paidGroup as any).attendance ?? null;
        const isCancelled = attStatus === 'cancelled' || attVal === -2;
        const dbCancelled = Boolean((client as any).paidServiceCancelled ?? false);
        const dbPaidAttended = (client as any).paidServiceAttended ?? null;
        const dbPaidAttVal = (client as any).paidServiceAttendanceValue ?? null;

        let newPaidAttended: boolean | null = null;
        if (attStatus === 'arrived' || attVal === 1 || attVal === 2) newPaidAttended = true;
        else if (attStatus === 'no-show' || attVal === -1) newPaidAttended = false;

        const cancelledMismatch = isCancelled !== dbCancelled;
        const attendedMismatch = newPaidAttended !== null && dbPaidAttended !== newPaidAttended;
        // Раніше needUpdate був false, якщо attended уже true — paidServiceAttendanceValue ніколи не backfill з групи (1 vs 2).
        const valueMismatch =
          newPaidAttended === true &&
          (attVal === 1 || attVal === 2) &&
          dbPaidAttVal !== attVal;

        if (!cancelledMismatch && !attendedMismatch && !valueMismatch) continue;

        const updateData: any = {};

        if (cancelledMismatch || attendedMismatch) {
          updateData.lastActivityAt = new Date();
          updateData.lastActivityKeys = isCancelled ? ['paidServiceCancelled'] : ['paidServiceAttended'];
          if (isCancelled) {
            updateData.paidServiceCancelled = true;
            updateData.paidServiceAttended = null;
            updateData.paidServiceAttendanceValue = null;
          } else if (newPaidAttended !== null) {
            updateData.paidServiceAttended = newPaidAttended;
            updateData.paidServiceCancelled = false;
            if (newPaidAttended && (attVal === 1 || attVal === 2)) {
              updateData.paidServiceAttendanceValue = attVal;
            }
            if (newPaidAttended === false) {
              updateData.paidServiceAttendanceValue = null;
            }
          }
        } else if (valueMismatch) {
          // Лише синхронізація 1/2 з вебхук-групи — без фейкового lastActivity
          updateData.paidServiceAttendanceValue = attVal;
        }

        await prisma.directClient.update({
          where: { id: client.id },
          data: updateData,
        });
        updatedCount++;
        console.log(
          `[cron/sync-paid-service-dates] ✅ Attendance sync client ${client.id} (${client.instagramUsername}): cancelled=${isCancelled}, attendedMismatch=${attendedMismatch}, valueMismatch=${valueMismatch}`
        );
      } catch (err) {
        const errorMsg = `Failed attendance sync for client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
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
