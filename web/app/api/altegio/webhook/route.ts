// web/app/api/altegio/webhook/route.ts
// Webhook endpoint для отримання сповіщень від Altegio API

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';
import {
  getActiveReminderRules,
  generateReminderJobId,
  calculateDueAt,
  type ReminderJob,
} from '@/lib/altegio/reminders';
import { getMastersDisplayFromVisitDetails, fetchVisitBreakdownFromAPI } from '@/lib/altegio/visits';
import { pushLastVisitAtUpdate } from '@/lib/direct-last-visit-updates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Перевіряє, чи є послуга "Консультація" або "Онлайн-консультація"
 * Повертає об'єкт з інформацією про те, чи це консультація та чи це онлайн-консультація
 */
function isConsultationService(services: any[]): { isConsultation: boolean; isOnline: boolean } {
  if (!Array.isArray(services) || services.length === 0) {
    return { isConsultation: false, isOnline: false };
  }
  
  let isConsultation = false;
  let isOnline = false;
  
  services.forEach((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    // Перевіряємо, чи це консультація (з "я" або без - "консультаці")
    // Використовуємо більш гнучкий регулярний вираз, який знаходить обидва варіанти
    if (/консультаці/i.test(title)) {
      isConsultation = true;
      // Перевіряємо, чи це онлайн-консультація
      // ВАЖЛИВО: також перевіряємо "Онлайн-консультаці" (без "я" в кінці)
      if (/онлайн/i.test(title) || 
          /online/i.test(title)) {
        isOnline = true;
      }
    }
  });
  
  return { isConsultation, isOnline };
}

/**
 * Перевіряє, чи staffName є адміністратором (role = 'admin' або 'direct-manager')
 */
async function isAdminStaff(staffName: string | null | undefined): Promise<boolean> {
  if (!staffName) {
    return false;
  }
  try {
    const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
    const masters = await getAllDirectMasters();
    const adminMaster = masters.find(m => 
      m.name === staffName && (m.role === 'admin' || m.role === 'direct-manager')
    );
    return !!adminMaster;
  } catch (err) {
    console.warn(`[altegio/webhook] Failed to check if staff "${staffName}" is admin:`, err);
    return false;
  }
}

/**
 * Перевіряє, чи в історії станів клієнта вже є консультації
 */
async function hasConsultationInHistory(clientId: string): Promise<boolean> {
  try {
    const { getStateHistory } = await import('@/lib/direct-state-log');
    const history = await getStateHistory(clientId);
    const consultationStates = ['consultation', 'consultation-booked', 'consultation-no-show', 'consultation-rescheduled'];
    return history.some(log => consultationStates.includes(log.state || ''));
  } catch (err) {
    console.warn(`[altegio/webhook] Failed to check consultation history for client ${clientId}:`, err);
    return false;
  }
}

/**
 * Перевіряє, чи до першої платної послуги клієнт мав тільки консультації
 * Повертає true, якщо в історії послуг до першої платної послуги були тільки консультації
 */
async function hadOnlyConsultationsBeforePaidService(altegioClientId: number, currentDateTime: string): Promise<boolean> {
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
      .filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const recordClientId = r.clientId || (r.data && r.data.client && r.data.client.id) || (r.data && r.data.client_id);
        if (!recordClientId) return false;
        const parsedClientId = parseInt(String(recordClientId), 10);
        return !isNaN(parsedClientId) && parsedClientId === altegioClientId;
      })
      .filter((r) => {
        // Перевіряємо, що запис має services
        if (!r.data || !Array.isArray(r.data.services)) return false;
        return true;
      })
      .sort((a, b) => {
        // Сортуємо за датою (від старіших до новіших)
        const dateA = a.datetime || a.receivedAt || '';
        const dateB = b.datetime || b.receivedAt || '';
        return new Date(dateA).getTime() - new Date(dateB).getTime();
      });
    
    // Знаходимо першу платну послугу (не консультацію)
    let firstPaidServiceIndex = -1;
    for (let i = 0; i < clientRecords.length; i++) {
      const record = clientRecords[i];
      const services = record.data?.services || [];
      const hasConsultation = services.some((s: any) => {
        const title = s.title || s.name || '';
        return /консультація/i.test(title);
      });
      if (!hasConsultation) {
        firstPaidServiceIndex = i;
        break;
      }
    }
    
    // Якщо платної послуги немає - повертаємо false
    if (firstPaidServiceIndex === -1) {
      return false;
    }
    
    // Перевіряємо, чи до першої платної послуги були тільки консультації
    for (let i = 0; i < firstPaidServiceIndex; i++) {
      const record = clientRecords[i];
      const services = record.data?.services || [];
      const hasConsultation = services.some((s: any) => {
        const title = s.title || s.name || '';
        return /консультація/i.test(title);
      });
      if (!hasConsultation) {
        // Знайдено неконсультаційну послугу до першої платної
        return false;
      }
    }
    
    // Якщо до першої платної послуги були тільки консультації
    return firstPaidServiceIndex > 0;
  } catch (err) {
    console.warn(`[altegio/webhook] Failed to check consultation history before paid service for client ${altegioClientId}:`, err);
    return false;
  }
}

/**
 * Webhook endpoint для Altegio
 * Отримує сповіщення про події в Altegio (appointments, clients, etc.)
 */
// Хелпер для синхронізації lastVisitAt з Altegio API
async function syncLastVisitAtFromAltegio(altegioClientId: number): Promise<string | undefined> {
  try {
    const { getClient } = await import('@/lib/altegio/clients');
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (companyId && !Number.isNaN(companyId)) {
      const altegioClient = await getClient(companyId, altegioClientId);
      const raw = (altegioClient as any)?.last_visit_date ?? (altegioClient as any)?.lastVisitDate ?? null;
      const s = raw ? String(raw).trim() : '';
      if (s) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          return d.toISOString();
        }
      }
    }
  } catch (err) {
    console.warn('[altegio/webhook] ⚠️ Не вдалося витягнути lastVisitAt з Altegio (не критично):', err);
  }
  return undefined;
}

/**
 * lastVisitAt з дати візиту вебхука (attendance=1).
 * Не перезаписуємо на старішу дату.
 */
function lastVisitAtFromWebhookDatetime(
  visitDatetime: string | null | undefined,
  currentLastVisitAt: string | null | undefined
): string | undefined {
  if (!visitDatetime || !String(visitDatetime).trim()) return undefined;
  const d = new Date(String(visitDatetime).trim());
  if (isNaN(d.getTime())) return undefined;
  const visitIso = d.toISOString();
  if (currentLastVisitAt) {
    const cur = new Date(String(currentLastVisitAt).trim()).getTime();
    if (Number.isFinite(cur) && d.getTime() <= cur) return undefined;
  }
  return visitIso;
}

/**
 * Синхронізує spent та visits з Altegio (lastVisitAt тепер з вебхука при attendance=1).
 */
async function syncClientMetricsFromAltegio(altegioClientId: number): Promise<{
  spent?: number | null;
  visits?: number | null;
}> {
  const result: { spent?: number | null; visits?: number | null } = {};
  
  // Оновлюємо тільки spent та visits
  try {
    const { fetchAltegioClientMetrics } = await import('@/lib/altegio/metrics');
    const metrics = await fetchAltegioClientMetrics({ altegioClientId });
    if (metrics.ok) {
      result.spent = metrics.metrics.spent ?? null;
      result.visits = metrics.metrics.visits ?? null;
    }
  } catch (err) {
    console.warn('[altegio/webhook] ⚠️ Не вдалося витягнути spent/visits з Altegio (не критично):', err);
  }
  
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    console.log('[altegio/webhook] Received webhook:', {
      timestamp: new Date().toISOString(),
      bodyKeys: Object.keys(body),
      eventType: body.event || body.type || 'unknown',
    });

    // Зберігаємо подію в KV (тільки останні 50 штук) для діагностики
    try {
      const entry = {
        receivedAt: new Date().toISOString(),
        event: body.event || body.type || null,
        body,
      };
      const payload = JSON.stringify(entry);
      await kvWrite.lpush('altegio:webhook:log', payload);
      // залишаємо останні 10000 для статистики (узгоджено з records:log)
      await kvWrite.ltrim('altegio:webhook:log', 0, 9999);
    } catch (err) {
      console.warn('[altegio/webhook] Failed to persist webhook to KV:', err);
    }

    // Обробка подій по записах (record)
    if (body.resource === 'record') {
      const recordId = body.resource_id; // Це record_id, а не visit_id
      const visitId = body.data?.visit_id || body.resource_id; // Використовуємо data.visit_id якщо є
      const status = body.status; // 'create', 'update', 'delete'
      const data = body.data || {};

      console.log('[altegio/webhook] Processing record event:', {
        recordId,
        visitId,
        status,
        hasData: !!data,
        dataKeys: Object.keys(data),
        datetime: data.datetime,
        hasClient: !!data.client,
        clientKeys: data.client ? Object.keys(data.client) : [],
        hasServices: Array.isArray(data.services) && data.services.length > 0,
        servicesCount: Array.isArray(data.services) ? data.services.length : 0,
      });

      if (status === 'delete') {
        // Скасовуємо всі нагадування для видаленого запису
        try {
          const visitJobsKey = `altegio:reminder:byVisit:${visitId}`;
          const jobIdsRaw = await kvRead.getRaw(visitJobsKey);

          if (jobIdsRaw) {
            const jobIds: string[] = JSON.parse(jobIdsRaw);

            for (const jobId of jobIds) {
              const jobKey = `altegio:reminder:job:${jobId}`;
              const jobRaw = await kvRead.getRaw(jobKey);

              if (jobRaw) {
                const job: ReminderJob = JSON.parse(jobRaw);
                // Помічаємо як скасований
                job.status = 'canceled';
                job.updatedAt = Date.now();
                job.canceledAt = Date.now();
                await kvWrite.setRaw(jobKey, JSON.stringify(job));
              }
            }

            // Очищаємо індекс по visitId
            await kvWrite.setRaw(visitJobsKey, JSON.stringify([]));
          }

          console.log(
            `[altegio/webhook] ✅ Canceled reminders for deleted visit ${visitId}`,
          );
        } catch (err) {
          console.error(
            `[altegio/webhook] ❌ Failed to cancel reminders for visit ${visitId}:`,
            err,
          );
        }
      } else if (status === 'update' || status === 'create') {
        // Зберігаємо record event для статистики (навіть якщо в минулому)
        try {
          // В webhook data.services - це масив, беремо перший service
          const firstService = Array.isArray(data.services) && data.services.length > 0
            ? data.services[0]
            : data.service || null;

          // attendance/visit_attendance потрібні для історії записів (record-history), щоб не показувати «Невідомо»
          const attendance = (data as any).attendance ?? (data as any).visit_attendance ?? undefined;
          const recordEvent = {
            visitId: visitId, // Використовуємо правильний visit_id
            recordId: recordId, // Також зберігаємо record_id для діагностики
            status,
            datetime: data.datetime,
            serviceId: firstService?.id || data.service_id,
            serviceName: firstService?.title || firstService?.name || data.service?.title || data.service?.name,
            staffId: data.staff?.id || data.staff_id,
            clientId: data.client?.id || data.client_id,
            companyId: data.company_id,
            receivedAt: new Date().toISOString(),
            attendance, // для normalizeRecordsLogItems / історія консультацій та записів
            visit_attendance: (data as any).visit_attendance,
            data: {
              service: firstService || data.service,
              services: data.services, // Зберігаємо весь масив services
              staff: data.staff,
              client: data.client,
              attendance: (data as any).attendance,
              visit_attendance: (data as any).visit_attendance,
            },
          };
          const recordPayload = JSON.stringify(recordEvent);
          await kvWrite.lpush('altegio:records:log', recordPayload);
          // Зберігаємо останні 10000 записів для статистики
          await kvWrite.ltrim('altegio:records:log', 0, 9999);
          console.log(`[altegio/webhook] ✅ Saved record event for stats: visitId=${visitId}, recordId=${recordId}, serviceId=${recordEvent.serviceId}, serviceName=${recordEvent.serviceName}, datetime=${data.datetime}`);
        } catch (err) {
          console.warn('[altegio/webhook] Failed to save record event for stats:', err);
        }

        // ОБРОБКА КОНСУЛЬТАЦІЙ (consultation-booked, consultation-rescheduled, consultation-no-show, consultation)
        if (data.client && data.client.id && Array.isArray(data.services) && data.services.length > 0) {
          try {
            const { getAllDirectClients, saveDirectClient } = await import('@/lib/direct-store');
            const { getMasterByName } = await import('@/lib/direct-masters/store');
            
            const clientId = parseInt(String(data.client.id), 10);
            const services = data.services;
            const staffName = data.staff?.name || data.staff?.display_name || null;

            // Виклик API Visit Details для отримання майстрів по кожній послузі (головний + інші в дужках)
            let mastersDisplayString: string | null = null;
            const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
            const companyId = parseInt(companyIdStr, 10);
            if (companyId && !Number.isNaN(companyId) && recordId != null && visitId != null) {
              mastersDisplayString = await getMastersDisplayFromVisitDetails(
                companyId,
                Number(recordId),
                Number(visitId),
                staffName
              );
              if (mastersDisplayString) {
                console.log('[altegio/webhook] Visit details masters display:', mastersDisplayString);
              }
            }
            // attendance / visit_attendance (Altegio): -1 не прийшов, 0 очікування, 1 прийшов, 2 підтвердив запис
            const attendance =
              (data as any).attendance ??
              (data as any).visit_attendance ??
              undefined;
            const isArrived = attendance === 1 || attendance === 2;
            const isNotArrived = attendance !== 1 && attendance !== 2;
            const datetime = data.datetime;
            
            const consultationInfo = isConsultationService(services);
            const hasConsultation = consultationInfo.isConsultation;
            const isOnlineConsultation = consultationInfo.isOnline;
            
            if (hasConsultation) {
              const existingDirectClients = await getAllDirectClients();
              let existingClient = existingDirectClients.find(
                (c) => c.altegioClientId === clientId
              );
              
              // Якщо клієнта не знайдено за altegioClientId, шукаємо за іменем
              if (!existingClient && data.client) {
                const clientName = data.client.name || data.client.display_name || '';
                const nameParts = clientName.trim().split(/\s+/);
                const firstName = nameParts[0] || '';
                const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
                
                if (firstName) {
                  // Спочатку шукаємо за ім'ям + прізвищем (якщо обидва є)
                  if (lastName) {
                    existingClient = existingDirectClients.find((dc) => {
                      const dcFirstName = (dc.firstName || '').trim().toLowerCase();
                      const dcLastName = (dc.lastName || '').trim().toLowerCase();
                      const searchFirstName = firstName.trim().toLowerCase();
                      const searchLastName = lastName.trim().toLowerCase();
                      
                      return dcFirstName === searchFirstName && dcLastName === searchLastName;
                    }) || undefined;
                  }
                  
                  // Якщо не знайдено і є тільки ім'я (без прізвища), шукаємо за тільки ім'ям
                  if (!existingClient && !lastName) {
                    existingClient = existingDirectClients.find((dc) => {
                      const dcFirstName = (dc.firstName || '').trim().toLowerCase();
                      const dcLastName = (dc.lastName || '').trim().toLowerCase();
                      const searchFirstName = firstName.trim().toLowerCase();
                      
                      // Шукаємо за ім'ям, якщо прізвище відсутнє або порожнє
                      return dcFirstName === searchFirstName && (!dcLastName || dcLastName === '');
                    }) || undefined;
                  }
                  
                  if (existingClient) {
                    const foundByName = lastName ? `${firstName} ${lastName}` : firstName;
                    console.log(`[altegio/webhook] 🔍 Found client by name "${foundByName}" for consultation: ${existingClient.id}, Instagram: ${existingClient.instagramUsername}, altegioClientId: ${existingClient.altegioClientId || 'none'}`);
                    
                    // Встановлюємо altegioClientId, якщо його ще немає
                    if (!existingClient.altegioClientId) {
                      const updated = {
                        ...existingClient,
                        altegioClientId: clientId,
                        updatedAt: new Date().toISOString(),
                      };
                      await saveDirectClient(updated, 'altegio-webhook-set-altegio-client-id-from-consultation', {
                        altegioClientId: clientId,
                        staffName,
                        datetime,
                        reason: 'found by name, setting altegioClientId',
                      });
                      existingClient = updated;
                      console.log(`[altegio/webhook] ✅ Set altegioClientId for client ${existingClient.id} from consultation webhook`);
                    }
                  }
                }
              }
              
              if (existingClient) {
                const wasAdminStaff = await isAdminStaff(staffName);
                const hadConsultationBefore = await hasConsultationInHistory(existingClient.id);
                // Не перезаписувати консультацію з вебхука, якщо її позначено як видалену в Altegio (404)
                const skipConsultationSet = (existingClient as any).consultationDeletedInAltegio === true;
                
                // Очищаємо paidServiceDate для консультацій, якщо він був встановлений помилково
                // Це може статися, якщо раніше вебхук обробив консультацію як платну послугу
                if (existingClient.paidServiceDate && !existingClient.signedUpForPaidService) {
                  // Якщо signedUpForPaidService = false, значить це помилка - очищаємо
                  const cleanupUpdates: Partial<typeof existingClient> = {
                    paidServiceDate: undefined,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  const cleanupUpdated: typeof existingClient = {
                    ...existingClient,
                    ...cleanupUpdates,
                  };
                  
                  await saveDirectClient(cleanupUpdated, 'altegio-webhook-cleanup-paid-service-date-for-consultation', {
                    altegioClientId: clientId,
                    staffName,
                    datetime,
                    reason: 'consultation webhook - clearing incorrectly set paidServiceDate',
                  });
                  
                  console.log(`[altegio/webhook] 🧹 Cleaned up paidServiceDate for consultation client ${existingClient.id}`);
                }
                
                // 2.2 Обробка запису на консультацію (ПЕРША консультація)
                // Встановлюємо 'consultation-booked' якщо є запис на консультацію і ще не було консультацій
                // Якщо клієнт ще не прийшов (не 1/2) - встановлюємо 'consultation-booked'
                // Якщо клієнт прийшов (attendance 1 або 2) - обробляється нижче
                if (!skipConsultationSet && (status === 'create' || status === 'update') && !hadConsultationBefore && isNotArrived) {
                  // ВАЖЛИВО: для консультацій ЗАВЖДИ очищаємо paidServiceDate
                  const updates: Partial<typeof existingClient> = {
                    state: 'consultation-booked',
                    consultationBookingDate: datetime,
                    isOnlineConsultation: isOnlineConsultation,
                    consultationDeletedInAltegio: false,
                    // Очищаємо paidServiceDate для консультацій, якщо клієнт не має платних послуг
                    paidServiceDate: existingClient.signedUpForPaidService ? existingClient.paidServiceDate : undefined,
                    signedUpForPaidService: existingClient.signedUpForPaidService ? existingClient.signedUpForPaidService : false,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  // Якщо paidServiceDate встановлений, але signedUpForPaidService = false - це помилка, очищаємо
                  if (existingClient.paidServiceDate && !existingClient.signedUpForPaidService) {
                    updates.paidServiceDate = undefined;
                    console.log(`[altegio/webhook] 🧹 Cleaning up paidServiceDate in consultation-booked block for client ${existingClient.id}`);
                  }
                  
                  const updated: typeof existingClient = {
                    ...existingClient,
                    ...updates,
                  };
                  
                  await saveDirectClient(updated, 'altegio-webhook-consultation-booked', {
                    altegioClientId: clientId,
                    staffName,
                    datetime,
                  });
                  
                  console.log(`[altegio/webhook] ✅ Set consultation-booked state for client ${existingClient.id} (status: ${status}, attendance: ${attendance})`);
                }
                // 2.3 Обробка переносу дати
                else if (!skipConsultationSet && status === 'update' && wasAdminStaff && hadConsultationBefore) {
                  // Перевіряємо чи дата змінилась
                  const oldBookingDate = existingClient.consultationBookingDate;
                  if (oldBookingDate && datetime && oldBookingDate !== datetime) {
                    const updates: Partial<typeof existingClient> = {
                      state: 'consultation-rescheduled',
                      consultationBookingDate: datetime,
                      isOnlineConsultation: isOnlineConsultation,
                      consultationDeletedInAltegio: false,
                      updatedAt: new Date().toISOString(),
                    };
                    
                    const updated: typeof existingClient = {
                      ...existingClient,
                      ...updates,
                    };
                    
                    await saveDirectClient(updated, 'altegio-webhook-consultation-rescheduled', {
                      altegioClientId: clientId,
                      staffName,
                      datetime,
                      oldDate: oldBookingDate,
                    });
                    
                    console.log(`[altegio/webhook] ✅ Set consultation-rescheduled state for client ${existingClient.id}`);
                  }
                }
                // 2.3.1 Оновлення consultationBookingDate для клієнтів зі станом consultation-booked
                // Якщо клієнт вже має стан consultation-booked, але дата оновилась або не була встановлена
                else if (!skipConsultationSet && (status === 'create' || status === 'update') && 
                         existingClient.state === 'consultation-booked' && 
                         isNotArrived && 
                         datetime) {
                  // Оновлюємо consultationBookingDate, якщо він відсутній або змінився
                  if (!existingClient.consultationBookingDate || existingClient.consultationBookingDate !== datetime) {
                    const updates: Partial<typeof existingClient> = {
                      consultationBookingDate: datetime,
                      isOnlineConsultation: isOnlineConsultation,
                      consultationDeletedInAltegio: false,
                      updatedAt: new Date().toISOString(),
                    };
                    
                    const updated: typeof existingClient = {
                      ...existingClient,
                      ...updates,
                    };
                    
                    await saveDirectClient(updated, 'altegio-webhook-update-consultation-booking-date', {
                      altegioClientId: clientId,
                      staffName,
                      datetime,
                      oldDate: existingClient.consultationBookingDate,
                    });
                    
                    console.log(`[altegio/webhook] ✅ Updated consultationBookingDate for client ${existingClient.id} (${existingClient.consultationBookingDate} -> ${datetime})`);
                  }
                }
                // 2.3.2 Встановлення consultationBookingDate для ВСІХ клієнтів з консультацією
                // Якщо consultationBookingDate відсутній або змінився, встановлюємо його незалежно від стану
                // Це fallback логіка, яка спрацьовує, якщо попередні блоки не спрацювали
                // ВАЖЛИВО: Цей блок має спрацювати для ВСІХ консультацій, навіть якщо попередні блоки не спрацювали
                if (!skipConsultationSet && (status === 'create' || status === 'update') && 
                    datetime && 
                    isNotArrived &&
                    (!existingClient.consultationBookingDate || existingClient.consultationBookingDate !== datetime)) {
                  // Перевіряємо, чи не встановили consultationBookingDate в попередніх блоках
                  // Якщо ні - встановлюємо його тут
                  // ВАЖЛИВО: для консультацій ЗАВЖДИ очищаємо paidServiceDate, якщо signedUpForPaidService = false
                  const updates: Partial<typeof existingClient> = {
                    consultationBookingDate: datetime,
                    isOnlineConsultation: isOnlineConsultation,
                    consultationDeletedInAltegio: false,
                    // Очищаємо paidServiceDate для консультацій, якщо клієнт не має платних послуг
                    paidServiceDate: existingClient.signedUpForPaidService ? existingClient.paidServiceDate : undefined,
                    signedUpForPaidService: existingClient.signedUpForPaidService ? existingClient.signedUpForPaidService : false,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  // Встановлюємо consultationAttended на основі attendance (1 або 2 = прийшов)
                  if (isArrived) {
                    updates.consultationAttended = true;
                    console.log(`[altegio/webhook] Setting consultationAttended to true (attendance = ${attendance}) in block 2.3.2 for client ${existingClient.id}`);
                    
                    // lastVisitAt з дати візиту вебхука (не з Altegio API)
                    const visitIso = lastVisitAtFromWebhookDatetime(datetime, (existingClient as any).lastVisitAt);
                    if (visitIso) updates.lastVisitAt = visitIso;
                    // Синхронізуємо spent/visits з Altegio
                    if (existingClient.altegioClientId) {
                      const metrics = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                      if (metrics.spent !== undefined) updates.spent = metrics.spent;
                      if (metrics.visits !== undefined) updates.visits = metrics.visits;
                    }
                  } else if (attendance === -1) {
                    // Встановлюємо false тільки якщо consultationAttended ще не встановлено як true
                    // Це запобігає перезапису true на false, якщо раніше був вебхук з attendance = 1
                    if (existingClient.consultationAttended !== true) {
                      updates.consultationAttended = false;
                      console.log(`[altegio/webhook] Setting consultationAttended to false (attendance = -1) in block 2.3.2 for client ${existingClient.id}`);
                    } else {
                      console.log(`[altegio/webhook] Keeping consultationAttended = true (attendance = -1, but already set to true from previous webhook) for client ${existingClient.id}`);
                    }
                  } else {
                    // Якщо attendance не встановлено, не встановлюємо consultationAttended (залишаємо null/undefined)
                    // Це дозволить відрізнити "не встановлено" від "не з'явився"
                    console.log(`[altegio/webhook] Not setting consultationAttended (attendance = ${attendance}, not 1/2 or -1) in block 2.3.2 for client ${existingClient.id}`);
                  }
                  
                  // Якщо paidServiceDate встановлений, але signedUpForPaidService = false - це помилка, очищаємо
                  if (existingClient.paidServiceDate && !existingClient.signedUpForPaidService) {
                    updates.paidServiceDate = undefined;
                    console.log(`[altegio/webhook] 🧹 Cleaning up paidServiceDate for consultation client ${existingClient.id} (signedUpForPaidService is false)`);
                  }
                  
                  const updated: typeof existingClient = {
                    ...existingClient,
                    ...updates,
                  };
                  
                  await saveDirectClient(updated, 'altegio-webhook-set-consultation-booking-date', {
                    altegioClientId: clientId,
                    staffName,
                    datetime,
                    oldDate: existingClient.consultationBookingDate,
                    currentState: existingClient.state,
                    hadConsultationBefore,
                    attendance,
                  });
                  if ((updated as any).lastVisitAt) pushLastVisitAtUpdate(updated.id, (updated as any).lastVisitAt).catch(() => {});

                  console.log(`[altegio/webhook] ✅ Set consultationBookingDate (fallback) for client ${existingClient.id} (state: ${existingClient.state}, ${existingClient.consultationBookingDate || 'null'} -> ${datetime})`);
                } else if (!skipConsultationSet && (status === 'create' || status === 'update') && datetime && isNotArrived && !existingClient.consultationBookingDate) {
                  // ДОДАТКОВА ПЕРЕВІРКА: Якщо consultationBookingDate все ще відсутній після всіх блоків
                  // (навіть якщо він не змінився, але його взагалі немає) - встановлюємо його
                  console.log(`[altegio/webhook] ⚠️ consultationBookingDate is missing for client ${existingClient.id}, setting it now (datetime: ${datetime}, attendance: ${attendance}, state: ${existingClient.state})`);
                  const updates: Partial<typeof existingClient> = {
                    consultationBookingDate: datetime,
                    isOnlineConsultation: isOnlineConsultation,
                    consultationDeletedInAltegio: false,
                    paidServiceDate: existingClient.signedUpForPaidService ? existingClient.paidServiceDate : undefined,
                    signedUpForPaidService: existingClient.signedUpForPaidService ? existingClient.signedUpForPaidService : false,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  // Встановлюємо consultationAttended (1 або 2 = прийшов)
                  if (isArrived) {
                    updates.consultationAttended = true;
                    console.log(`[altegio/webhook] Setting consultationAttended to true (attendance = ${attendance}) in missing date block for client ${existingClient.id}`);
                    
                    // lastVisitAt з дати візиту вебхука
                    const visitIsoMissing = lastVisitAtFromWebhookDatetime(datetime, (existingClient as any).lastVisitAt);
                    if (visitIsoMissing) updates.lastVisitAt = visitIsoMissing;
                    if (existingClient.altegioClientId) {
                      const metrics = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                      if (metrics.spent !== undefined) updates.spent = metrics.spent;
                      if (metrics.visits !== undefined) updates.visits = metrics.visits;
                    }
                  } else if (attendance === -1) {
                    // Встановлюємо false тільки якщо consultationAttended ще не встановлено як true
                    // Це запобігає перезапису true на false, якщо раніше був вебхук з attendance = 1
                    if (existingClient.consultationAttended !== true) {
                      updates.consultationAttended = false;
                      console.log(`[altegio/webhook] Setting consultationAttended to false (attendance = -1) in missing date block for client ${existingClient.id}`);
                    } else {
                      console.log(`[altegio/webhook] Keeping consultationAttended = true (attendance = -1, but already set to true from previous webhook) in missing date block for client ${existingClient.id}`);
                    }
                  } else {
                    // Якщо attendance не встановлено, не встановлюємо consultationAttended (залишаємо null/undefined)
                    // Це дозволить відрізнити "не встановлено" від "не з'явився"
                    console.log(`[altegio/webhook] Not setting consultationAttended (attendance = ${attendance}, not 1/2 or -1) in missing date block for client ${existingClient.id}`);
                  }
                  
                  const updated: typeof existingClient = {
                    ...existingClient,
                    ...updates,
                  };
                  
                  await saveDirectClient(updated, 'altegio-webhook-set-consultation-booking-date-missing', {
                    altegioClientId: clientId,
                    staffName,
                    datetime,
                    currentState: existingClient.state,
                    hadConsultationBefore,
                    attendance,
                    reason: 'consultationBookingDate was missing after all blocks',
                  });
                  if ((updated as any).lastVisitAt) pushLastVisitAtUpdate(updated.id, (updated as any).lastVisitAt).catch(() => {});

                  console.log(`[altegio/webhook] ✅ Set missing consultationBookingDate for client ${existingClient.id} (${datetime})`);
                }
                // 2.4 Обробка неявки клієнта
                else if (attendance === -1) {
                  const updates: Partial<typeof existingClient> = {
                    state: 'consultation-no-show',
                    consultationAttended: false,
                    isOnlineConsultation: isOnlineConsultation,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  const updated: typeof existingClient = {
                    ...existingClient,
                    ...updates,
                  };
                  
                  await saveDirectClient(updated, 'altegio-webhook-consultation-no-show', {
                    altegioClientId: clientId,
                    staffName,
                    datetime,
                  });
                  
                  console.log(`[altegio/webhook] ✅ Set consultation-no-show state for client ${existingClient.id}`);
                }
                // Якщо після no-show приходить update з новою датою - це перенос
                else if (!skipConsultationSet && attendance === -1 && hadConsultationBefore && status === 'update' && wasAdminStaff) {
                  const oldBookingDate = existingClient.consultationBookingDate;
                  if (oldBookingDate && datetime && oldBookingDate !== datetime) {
                    const updates: Partial<typeof existingClient> = {
                      state: 'consultation-rescheduled',
                      consultationBookingDate: datetime,
                      consultationAttended: false, // Зберігаємо false, бо клієнт не з'явився
                      isOnlineConsultation: isOnlineConsultation,
                      consultationDeletedInAltegio: false,
                      updatedAt: new Date().toISOString(),
                    };
                    
                    const updated: typeof existingClient = {
                      ...existingClient,
                      ...updates,
                    };
                    
                    await saveDirectClient(updated, 'altegio-webhook-consultation-rescheduled-after-no-show', {
                      altegioClientId: clientId,
                      staffName,
                      datetime,
                      oldDate: oldBookingDate,
                    });
                    
                    console.log(`[altegio/webhook] ✅ Set consultation-rescheduled state (after no-show) for client ${existingClient.id}`);
                  }
                }
                // 2.5 Обробка приходу клієнта на консультацію
                // Якщо клієнт прийшов на консультацію (attendance 1 або 2), показуємо ✅ у колонці дати консультації.
                // ВАЖЛИВО: перевіряємо, чи дата консультації вже настала (datetime <= поточна дата)
                else if (!skipConsultationSet && isArrived && datetime) {
                  // Перевіряємо, чи дата консультації вже настала
                  const consultationDate = new Date(datetime);
                  const now = new Date();
                  const isPastOrToday = consultationDate <= now;
                  
                  // Якщо дата ще не настала, не встановлюємо стан 'consultation'
                  if (!isPastOrToday) {
                    console.log(`[altegio/webhook] ⏭️ Skipping consultation attendance for ${existingClient.id}: consultation date ${datetime} is in the future`);
                  } else {
                    // Перевіряємо, чи в історії вже є стан 'consultation' (фактична консультація)
                    const { getStateHistory } = await import('@/lib/direct-state-log');
                    const history = await getStateHistory(existingClient.id);
                    const hasActualConsultation = history.some(log => log.state === 'consultation');
                    
                    // Якщо ще немає фактичної консультації в історії, встановлюємо
                    if (!hasActualConsultation) {
                      // Знаходимо майстра
                      const master = await getMasterByName(staffName);
                      if (master) {
                        const normalizedState =
                          existingClient.state === 'consultation'
                            ? 'consultation-booked'
                            : existingClient.state;
                        const visitIsoMaster = lastVisitAtFromWebhookDatetime(datetime, (existingClient as any).lastVisitAt);
                        let metricsMaster: { spent?: number | null; visits?: number | null } = {};
                        if (existingClient.altegioClientId) {
                          metricsMaster = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                        }
                        const updates: Partial<typeof existingClient> = {
                          state: normalizedState,
                          consultationAttended: true,
                          consultationMasterId: master.id,
                          consultationMasterName: mastersDisplayString ?? master.name,
                          consultationDate: datetime, // Дата фактичної консультації
                          // Зберігаємо consultationBookingDate, якщо він є, інакше встановлюємо з datetime
                          consultationBookingDate: existingClient.consultationBookingDate || datetime,
                          isOnlineConsultation: isOnlineConsultation,
                          consultationDeletedInAltegio: false,
                          masterId: master.id, // Оновлюємо відповідального
                          masterManuallySet: false, // Автоматичне призначення
                          ...(visitIsoMaster && { lastVisitAt: visitIsoMaster }),
                          ...(metricsMaster.spent !== undefined && { spent: metricsMaster.spent }),
                          ...(metricsMaster.visits !== undefined && { visits: metricsMaster.visits }),
                          updatedAt: new Date().toISOString(),
                        };
                        
                        const updated: typeof existingClient = {
                          ...existingClient,
                          ...updates,
                        };
                        
                        await saveDirectClient(updated, 'altegio-webhook-consultation-attended', {
                          altegioClientId: clientId,
                          staffName,
                          masterId: master.id,
                          masterName: master.name,
                          datetime,
                        });
                        
                        console.log(`[altegio/webhook] ✅ Marked consultation attended for client ${existingClient.id}, master: ${master.name}`);
                      } else {
                        console.warn(`[altegio/webhook] ⚠️ Could not find master by name "${staffName}" for consultation attendance`);
                        // Навіть якщо майстра не знайдено, встановлюємо consultationAttended = true
                        const visitIsoNoMaster = lastVisitAtFromWebhookDatetime(datetime, (existingClient as any).lastVisitAt);
                        let metricsNoMaster: { spent?: number | null; visits?: number | null } = {};
                        if (existingClient.altegioClientId) {
                          metricsNoMaster = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                        }
                        const normalizedState =
                          existingClient.state === 'consultation'
                            ? 'consultation-booked'
                            : existingClient.state;
                        const updates: Partial<typeof existingClient> = {
                          state: normalizedState,
                          consultationAttended: true,
                          consultationDate: datetime,
                          consultationBookingDate: existingClient.consultationBookingDate || datetime,
                          isOnlineConsultation: isOnlineConsultation,
                          consultationDeletedInAltegio: false,
                          ...(visitIsoNoMaster && { lastVisitAt: visitIsoNoMaster }),
                          ...(metricsNoMaster.spent !== undefined && { spent: metricsNoMaster.spent }),
                          ...(metricsNoMaster.visits !== undefined && { visits: metricsNoMaster.visits }),
                          updatedAt: new Date().toISOString(),
                        };
                        const updated: typeof existingClient = {
                          ...existingClient,
                          ...updates,
                        };
                        await saveDirectClient(updated, 'altegio-webhook-consultation-attended-no-master', {
                          altegioClientId: clientId,
                          staffName: staffName || 'unknown',
                          datetime,
                        });
                        if ((updated as any).lastVisitAt) pushLastVisitAtUpdate(updated.id, (updated as any).lastVisitAt).catch(() => {});
                        console.log(`[altegio/webhook] ✅ Marked consultationAttended = true (no master found) for client ${existingClient.id}`);
                      }
                    } else {
                      // Якщо консультація вже є в історії, все одно оновлюємо consultationAttended, якщо він не встановлений
                      if (existingClient.consultationAttended !== true) {
                        const visitIsoExisting = lastVisitAtFromWebhookDatetime(datetime, (existingClient as any).lastVisitAt);
                        let metricsExisting: { spent?: number | null; visits?: number | null } = {};
                        if (existingClient.altegioClientId) {
                          metricsExisting = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                        }
                        const updates: Partial<typeof existingClient> = {
                          consultationAttended: true,
                          ...(visitIsoExisting && { lastVisitAt: visitIsoExisting }),
                          ...(metricsExisting.spent !== undefined && { spent: metricsExisting.spent }),
                          ...(metricsExisting.visits !== undefined && { visits: metricsExisting.visits }),
                          updatedAt: new Date().toISOString(),
                        };
                        const updated: typeof existingClient = {
                          ...existingClient,
                          ...updates,
                        };
                        await saveDirectClient(updated, 'altegio-webhook-consultation-attended-update', {
                          altegioClientId: clientId,
                          staffName: staffName || 'unknown',
                          datetime,
                        });
                        if ((updated as any).lastVisitAt) pushLastVisitAtUpdate(updated.id, (updated as any).lastVisitAt).catch(() => {});
                        console.log(`[altegio/webhook] ✅ Updated consultationAttended = true for existing consultation client ${existingClient.id}`);
                      } else {
                        console.log(`[altegio/webhook] ⏭️ Client ${existingClient.id} already has consultation state and consultationAttended = true, skipping`);
                      }
                    }
                  }
                }
                // 2.5.1 Fallback: Якщо клієнт прийшов (1/2), але попередній блок не спрацював — встановлюємо consultationAttended = true
                else if (!skipConsultationSet && isArrived && datetime) {
                  const consultationDate = new Date(datetime);
                  const now = new Date();
                  const isPastOrToday = consultationDate <= now;
                  
                  // Встановлюємо consultationAttended навіть для майбутніх дат (якщо вже відмічено в Altegio)
                  if (existingClient.consultationAttended !== true) {
                    const visitIsoFallback = lastVisitAtFromWebhookDatetime(datetime, (existingClient as any).lastVisitAt);
                    let metricsFallback: { spent?: number | null; visits?: number | null } = {};
                    if (existingClient.altegioClientId) {
                      metricsFallback = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                    }
                    const updates: Partial<typeof existingClient> = {
                      consultationAttended: true,
                      consultationBookingDate: existingClient.consultationBookingDate || datetime,
                      isOnlineConsultation: isOnlineConsultation,
                      consultationDeletedInAltegio: false,
                      ...(visitIsoFallback && { lastVisitAt: visitIsoFallback }),
                      ...(metricsFallback.spent !== undefined && { spent: metricsFallback.spent }),
                      ...(metricsFallback.visits !== undefined && { visits: metricsFallback.visits }),
                      updatedAt: new Date().toISOString(),
                    };
                    const updated: typeof existingClient = {
                      ...existingClient,
                      ...updates,
                    };
                    await saveDirectClient(updated, 'altegio-webhook-consultation-attended-fallback', {
                      altegioClientId: clientId,
                      staffName: staffName || 'unknown',
                      datetime,
                      isPastOrToday,
                    });
                    if ((updated as any).lastVisitAt) pushLastVisitAtUpdate(updated.id, (updated as any).lastVisitAt).catch(() => {});
                    console.log(`[altegio/webhook] ✅ Set consultationAttended = true (fallback) for client ${existingClient.id}, isPastOrToday: ${isPastOrToday}`);
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[altegio/webhook] ⚠️ Failed to process consultation logic:`, err);
            // Не зупиняємо обробку через помилку
          }
        }

        // ОНОВЛЕННЯ СТАНУ КЛІЄНТА НА ОСНОВІ SERVICES
        // Автоматично оновлюємо стан клієнта на основі послуг у записі
        // Це працює для ВСІХ клієнтів, навіть без custom_fields
        if (data.client && data.client.id && Array.isArray(data.services) && data.services.length > 0) {
          try {
            const { getAllDirectClients, saveDirectClient } = await import('@/lib/direct-store');
            const { determineStateFromServices } = await import('@/lib/direct-state-helper');
            const { getMasterByAltegioStaffId } = await import('@/lib/direct-masters/store');
            
            const clientId = parseInt(String(data.client.id), 10);
            const services = data.services;
            const staffId = data.staff?.id || data.staff_id;
            const staffName = data.staff?.name || data.staff?.display_name || null;

            // Виклик API Visit Details для рядка майстрів (головний + інші в дужках) у цьому блоці
            let mastersDisplayString: string | null = null;
            const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
            const companyId = parseInt(companyIdStr, 10);
            if (companyId && !Number.isNaN(companyId) && recordId != null && visitId != null) {
              mastersDisplayString = await getMastersDisplayFromVisitDetails(
                companyId,
                Number(recordId),
                Number(visitId),
                staffName
              );
            }
            // attendance / visit_attendance (Altegio): -1 не прийшов, 0 очікування, 1 прийшов, 2 підтвердив запис
            const attendance =
              (data as any).attendance ??
              (data as any).visit_attendance ??
              undefined;
            const isArrivedPaid = attendance === 1 || attendance === 2;
            
            // Визначаємо новий стан на основі послуг (з пріоритетом: нарощування > консультація)
            const newState = determineStateFromServices(services);
            
            // Перевіряємо, чи є послуга з нарощуванням
            const hasHairExtension = services.some((s: any) => {
              const title = s.title || s.name || '';
              return /нарощування/i.test(title);
            });
            
            // Перевіряємо, чи є послуга "Консультація"
            const hasConsultation = services.some((s: any) => {
              const title = s.title || s.name || '';
              return /консультація/i.test(title);
            });
            
            // ВАЖЛИВО: Обробляємо клієнтів навіть якщо newState null, якщо є нарощування або консультація
            // Це гарантує, що paidServiceDate буде встановлено для всіх платних послуг
            if (newState || hasHairExtension || hasConsultation) {
              // ВАЖЛИВО: Спочатку перевіряємо через getDirectClientByAltegioId (як в інших блоках)
              // Це знайде клієнта навіть якщо altegioClientId не встановлено в момент пошуку
              const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
              let existingClient = await getDirectClientByAltegioId(clientId);
              
              // Якщо не знайдено через getDirectClientByAltegioId, шукаємо через getAllDirectClients
              if (!existingClient) {
                const existingDirectClients = await getAllDirectClients();
                
                // Шукаємо клієнта за Altegio ID
                existingClient = existingDirectClients.find(
                  (c) => c.altegioClientId === clientId
                );
              }
              
              // Якщо клієнта не знайдено за altegioClientId, шукаємо за іменем
              if (!existingClient && data.client) {
                const existingDirectClients = await getAllDirectClients();
                const clientName = data.client.name || data.client.display_name || '';
                const nameParts = clientName.trim().split(/\s+/);
                const firstName = nameParts[0] || '';
                const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
                
                if (firstName) {
                  // Спочатку шукаємо за ім'ям + прізвищем (якщо обидва є)
                  if (lastName) {
                    existingClient = existingDirectClients.find((dc) => {
                      const dcFirstName = (dc.firstName || '').trim().toLowerCase();
                      const dcLastName = (dc.lastName || '').trim().toLowerCase();
                      const searchFirstName = firstName.trim().toLowerCase();
                      const searchLastName = lastName.trim().toLowerCase();
                      
                      return dcFirstName === searchFirstName && dcLastName === searchLastName;
                    }) || undefined;
                  }
                  
                  // Якщо не знайдено і є тільки ім'я (без прізвища), шукаємо за тільки ім'ям
                  if (!existingClient && !lastName) {
                    existingClient = existingDirectClients.find((dc) => {
                      const dcFirstName = (dc.firstName || '').trim().toLowerCase();
                      const dcLastName = (dc.lastName || '').trim().toLowerCase();
                      const searchFirstName = firstName.trim().toLowerCase();
                      
                      // Шукаємо за ім'ям, якщо прізвище відсутнє або порожнє
                      return dcFirstName === searchFirstName && (!dcLastName || dcLastName === '');
                    }) || undefined;
                  }
                  
                  if (existingClient) {
                    const foundByName = lastName ? `${firstName} ${lastName}` : firstName;
                    console.log(`[altegio/webhook] 🔍 Found client by name "${foundByName}" for state update: ${existingClient.id}, Instagram: ${existingClient.instagramUsername}, altegioClientId: ${existingClient.altegioClientId || 'none'}`);
                    
                    // Встановлюємо altegioClientId, якщо його ще немає
                    if (!existingClient.altegioClientId) {
                      const updated = {
                        ...existingClient,
                        altegioClientId: clientId,
                        updatedAt: new Date().toISOString(),
                      };
                      await saveDirectClient(updated, 'altegio-webhook-set-altegio-client-id-from-services', {
                        altegioClientId: clientId,
                        staffName,
                        datetime: data.datetime,
                        reason: 'found by name, setting altegioClientId',
                      });
                      existingClient = updated;
                      console.log(`[altegio/webhook] ✅ Set altegioClientId for client ${existingClient.id} from services webhook`);
                    }
                  }
                }
              }
              
              if (existingClient) {
                const { getMasterByName } = await import('@/lib/direct-masters/store');
                const { logMultipleStates } = await import('@/lib/direct-state-log');
                
                const previousState = existingClient.state;
                
                // Визначаємо фінальний стан: якщо newState null, але є нарощування, встановлюємо 'hair-extension'
                const finalState = newState || (hasHairExtension ? 'hair-extension' : null);
                
                const updates: Partial<typeof existingClient> = {
                  state: finalState && existingClient.state !== finalState ? finalState : existingClient.state,
                  updatedAt: new Date().toISOString(),
                };
                
                // Оновлюємо дату запису (paidServiceDate) з data.datetime, якщо вона є
                // ВАЖЛИВО: встановлюємо paidServiceDate ТІЛЬКИ для платних послуг (НЕ консультацій)
                // Не перезаписувати, якщо платний блок позначено як видалений в Altegio (404)
                if (data.datetime && !hasConsultation && !(existingClient as any).paidServiceDeletedInAltegio && (hasHairExtension || finalState === 'hair-extension' || finalState === 'other-services')) {
                  const appointmentDate = new Date(data.datetime);
                  const now = new Date();
                  // Встановлюємо paidServiceDate для майбутніх записів або якщо вона новіша за існуючу
                  if (appointmentDate > now) {
                    updates.paidServiceDate = data.datetime;
                    updates.signedUpForPaidService = true;
                    (updates as any).paidServiceDeletedInAltegio = false;
                    console.log(`[altegio/webhook] Setting paidServiceDate to ${data.datetime} (future, paid service) for client ${existingClient.id}`);
                  } else if (!existingClient.paidServiceDate || new Date(existingClient.paidServiceDate) < appointmentDate) {
                    // Для минулих дат встановлюємо тільки якщо paidServiceDate не встановлено або новіша
                    updates.paidServiceDate = data.datetime;
                    updates.signedUpForPaidService = true;
                    (updates as any).paidServiceDeletedInAltegio = false;
                    console.log(`[altegio/webhook] Setting paidServiceDate to ${data.datetime} (past date, but more recent than existing, paid service) for client ${existingClient.id}`);
                  }
                  
                  // Встановлюємо paidServiceAttended (1 або 2 = прийшов)
                  if (isArrivedPaid) {
                    updates.paidServiceAttended = true;
                    console.log(`[altegio/webhook] Setting paidServiceAttended to true (attendance = ${attendance}) for client ${existingClient.id}`);
                    // lastVisitAt з дати візиту вебхука (не з Altegio API)
                    const visitIsoPaid = lastVisitAtFromWebhookDatetime(data.datetime, (existingClient as any).lastVisitAt);
                    if (visitIsoPaid) updates.lastVisitAt = visitIsoPaid;
                    if (existingClient.altegioClientId) {
                      const metrics = await syncClientMetricsFromAltegio(existingClient.altegioClientId);
                      if (metrics.spent !== undefined) updates.spent = metrics.spent;
                      if (metrics.visits !== undefined) updates.visits = metrics.visits;
                    }
                  } else if (attendance === -1) {
                    updates.paidServiceAttended = false;
                    console.log(`[altegio/webhook] Setting paidServiceAttended to false (attendance = -1, no-show) for client ${existingClient.id}`);
                  } else {
                    // Якщо attendance не встановлено, не встановлюємо paidServiceAttended (залишаємо null/undefined)
                    // Це дозволить відрізнити "не встановлено" від "не з'явився"
                    console.log(`[altegio/webhook] Not setting paidServiceAttended (attendance = ${attendance}, not 1/2 or -1) for client ${existingClient.id}`);
                  }
                  
                  // 2.6 Визначення конверсії в платну послугу після консультації
                  // Перевіряємо тільки якщо це платна послуга (не консультація) і клієнт мав консультацію
                  if (existingClient.consultationDate) {
                    const hadOnlyConsultations = await hadOnlyConsultationsBeforePaidService(clientId, data.datetime);
                    if (hadOnlyConsultations) {
                      updates.signedUpForPaidServiceAfterConsultation = true;
                      console.log(`[altegio/webhook] Setting signedUpForPaidServiceAfterConsultation = true for client ${existingClient.id} (had only consultations before paid service)`);
                    }
                  }
                }
                
                // Автоматично призначаємо майстра, якщо:
                // 1. Відповідальний не був вибраний вручну
                // 2. Відповідальний не встановлений або потрібно оновити
                if (!existingClient.masterManuallySet) {
                  try {
                    let master = null;
                    
                    // Для нарощування - знаходимо за staff_id
                    if (hasHairExtension && staffId) {
                      master = await getMasterByAltegioStaffId(staffId);
                      if (master) {
                        updates.masterId = master.id;
                        console.log(`[altegio/webhook] Auto-assigned master ${master.name} (${master.id}) by staff_id ${staffId} to client ${existingClient.id} from record event`);
                      }
                    }
                    
                    // Для консультації - знаходимо за staffName
                    if ((hasConsultation || newState === 'consultation') && staffName && !master) {
                      master = await getMasterByName(staffName);
                      if (master) {
                        updates.masterId = master.id;
                        console.log(`[altegio/webhook] Auto-assigned master ${master.name} (${master.id}) by staffName "${staffName}" to client ${existingClient.id} from record event`);
                      } else {
                        console.warn(`[altegio/webhook] Could not find master by name "${staffName}" for client ${existingClient.id}`);
                      }
                    }
                  } catch (err) {
                    console.warn(`[altegio/webhook] Failed to auto-assign master:`, err);
                  }
                }
                
                // Встановлюємо serviceMasterName безпосередньо з вебхука (якщо це не адміністратор)
                // Це простіше і надійніше, ніж використовувати складне групування
                if (staffName && !hasConsultation) {
                  // Перевіряємо, чи це не адміністратор
                  const isAdmin = await isAdminStaff(staffName);
                  if (!isAdmin) {
                    // Встановлюємо serviceMasterName для платних послуг
                    if (data.datetime && (hasHairExtension || finalState === 'hair-extension' || finalState === 'other-services')) {
                      const { appendServiceMasterHistory } = await import('@/lib/altegio/records-grouping');
                      const { kyivDayFromISO } = await import('@/lib/altegio/records-grouping');
                      const kyivDay = data.datetime ? kyivDayFromISO(data.datetime) : '';
                      const paidMasterDisplay = mastersDisplayString ?? staffName;
                      updates.serviceMasterName = paidMasterDisplay;
                      updates.serviceMasterAltegioStaffId = staffId || null;
                      if (kyivDay) {
                        updates.serviceMasterHistory = appendServiceMasterHistory(existingClient.serviceMasterHistory, {
                          kyivDay,
                          masterName: paidMasterDisplay,
                          source: 'webhook-direct',
                        });
                      }
                      console.log(`[altegio/webhook] Set serviceMasterName = "${paidMasterDisplay}" directly from webhook for client ${existingClient.id}`);
                    }
                  } else {
                    console.log(`[altegio/webhook] Skipping admin "${staffName}" for serviceMasterName for client ${existingClient.id}`);
                  }
                }
                
                // Оновлюємо клієнта, якщо є зміни стану, відповідального або paidServiceDate
                const hasStateChange = finalState && existingClient.state !== finalState;
                const hasMasterChange = updates.masterId && updates.masterId !== existingClient.masterId;
                const hasPaidServiceDateChange = updates.paidServiceDate && existingClient.paidServiceDate !== updates.paidServiceDate;
                const hasSignedUpChange = updates.signedUpForPaidService !== undefined && existingClient.signedUpForPaidService !== updates.signedUpForPaidService;
                
                // ВАЖЛИВО: зміна стану або майстра не переміщає клієнта на верх
                // Використовуємо touchUpdatedAt: false, якщо змінюються тільки стан або майстер (без інших змін)
                const shouldTouchUpdatedAt = hasPaidServiceDateChange || hasSignedUpChange || 
                  (hasConsultation && hasHairExtension && finalState === 'hair-extension');
                
                if (hasStateChange || hasMasterChange || hasPaidServiceDateChange || hasSignedUpChange) {
                  const updated: typeof existingClient = {
                    ...existingClient,
                    ...updates,
                  };
                  
                  const metadata = {
                    altegioClientId: clientId,
                    visitId: data.id,
                    services: services.map((s: any) => ({ id: s.id, title: s.title })),
                    staffName,
                    masterId: updates.masterId,
                  };
                  
                  // Якщо є і консультація, і нарощування - логуємо обидва стани для конверсії
                  if (hasConsultation && hasHairExtension && finalState === 'hair-extension') {
                    // Логуємо обидва стани: спочатку консультацію, потім нарощування
                    const statesToLog: Array<{ state: string | null; previousState: string | null | undefined }> = [];
                    
                    // Якщо попередній стан не був консультацією - логуємо консультацію
                    if (previousState !== 'consultation-booked') {
                      statesToLog.push({ state: 'consultation-booked', previousState });
                    }
                    
                    // Логуємо нарощування (попередній стан - консультація, якщо вона була, інакше - попередній)
                    statesToLog.push({ 
                      state: 'hair-extension', 
                      previousState: previousState === 'consultation-booked' ? 'consultation-booked' : previousState 
                    });
                    
                    if (statesToLog.length > 0) {
                      await logMultipleStates(
                        existingClient.id,
                        statesToLog,
                        'altegio-webhook-record',
                        metadata
                      );
                    }
                    
                    // Зберігаємо клієнта без повторного логування (бо вже залоговано через logMultipleStates)
                    // Для конверсії консультація→нарощування залишаємо touchUpdatedAt (це важлива подія)
                    await saveDirectClient(updated, 'altegio-webhook-record', metadata, true);
                  } else {
                    // Звичайне логування для одного стану
                    // Якщо змінюються тільки стан або майстер - не переміщаємо на верх
                    await saveDirectClient(updated, 'altegio-webhook-record', metadata, shouldTouchUpdatedAt ? undefined : { touchUpdatedAt: false });
                  }
                  if ((updated as any).lastVisitAt) pushLastVisitAtUpdate(updated.id, (updated as any).lastVisitAt).catch(() => {});

                  if (hasStateChange) {
                    console.log(`[altegio/webhook] ✅ Updated client ${existingClient.id} state to '${finalState}' based on services (Altegio client ${clientId})`);
                  }
                  if (hasPaidServiceDateChange) {
                    console.log(`[altegio/webhook] ✅ Updated client ${existingClient.id} paidServiceDate to ${updates.paidServiceDate} (Altegio client ${clientId})`);
                  }
                } else {
                  console.log(`[altegio/webhook] ⏭️ No changes needed for client ${existingClient.id} (state: ${existingClient.state}, paidServiceDate: ${existingClient.paidServiceDate})`);
                }
              } else {
                console.log(`[altegio/webhook] ⏭️ Client ${clientId} not found in Direct Manager, skipping state update`);
              }
            }
          } catch (err) {
            console.error(`[altegio/webhook] ⚠️ Failed to update client state from record event:`, err);
            // Не зупиняємо обробку record події через помилку оновлення стану
          }

          // Отримуємо breakdown по майстрах з API (GET /visits/{visit_id} + GET /visit/details для кожного record) і зберігаємо в БД
          try {
            const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
            const companyId = parseInt(companyIdStr, 10);
            const altegioClientId = data.client?.id ?? data.client_id;
            if (
              visitId != null &&
              companyId && !Number.isNaN(companyId) &&
              altegioClientId != null
            ) {
              const { getDirectClientByAltegioId, saveDirectClient } = await import('@/lib/direct-store');
              const directClient = await getDirectClientByAltegioId(Number(altegioClientId));
              if (directClient) {
                // recordId: рахуємо breakdown тільки для цього запису, щоб сума відповідала платній послузі клієнта, а не всьому візиту
                const breakdown = await fetchVisitBreakdownFromAPI(
                  Number(visitId),
                  companyId,
                  recordId != null ? Number(recordId) : undefined
                );
                if (breakdown && breakdown.length > 0) {
                  const totalCost = breakdown.reduce((a, b) => a + b.sumUAH, 0);
                  const updated = {
                    ...directClient,
                    paidServiceVisitId: Number(visitId),
                    paidServiceRecordId: recordId != null ? Number(recordId) : undefined,
                    paidServiceVisitBreakdown: breakdown,
                    paidServiceTotalCost: totalCost,
                    updatedAt: new Date().toISOString(),
                  };
                  await saveDirectClient(updated, 'altegio-webhook-visit-breakdown-from-api', {
                    visitId: Number(visitId),
                    breakdownLength: breakdown.length,
                    totalCost,
                  });
                  console.log(`[altegio/webhook] ✅ Saved visit breakdown from API for client ${directClient.id} (visit ${visitId}, ${breakdown.length} masters, total ${totalCost} грн)`);
                }
              }
            }
          } catch (err) {
            console.warn('[altegio/webhook] Failed to fetch/save visit breakdown from API:', err);
          }
        }

        // ОБРОБКА КЛІЄНТА З RECORD ПОДІЇ (тільки якщо є custom_fields)
        // Altegio може не надсилати окремі події client.update, тому обробляємо клієнтів тут
        if (data.client && data.client.id) {
          try {
            const { getAllDirectClients, getAllDirectStatuses, saveDirectClient } = await import('@/lib/direct-store');
            const { normalizeInstagram } = await import('@/lib/normalize');
            
            const client = data.client;
            let instagram: string | null = null;
            
            // Перевіряємо custom_fields в клієнті з record події
            if (client.custom_fields) {
              // Варіант 1: custom_fields - це масив об'єктів (як в API)
              if (Array.isArray(client.custom_fields) && client.custom_fields.length > 0) {
                for (const field of client.custom_fields) {
                  if (field && typeof field === 'object') {
                    const title = field.title || field.name || field.label || '';
                    const value = field.value || field.data || field.content || field.text || '';
                    
                    if (value && typeof value === 'string' && /instagram/i.test(title)) {
                      instagram = value.trim();
                      break;
                    }
                  }
                }
              }
              // Варіант 2: custom_fields - це об'єкт з ключами (як в webhook'ах)
              else if (typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
                instagram =
                  client.custom_fields['instagram-user-name'] ||
                  client.custom_fields['Instagram user name'] ||
                  client.custom_fields['Instagram username'] ||
                  client.custom_fields.instagram_user_name ||
                  client.custom_fields.instagramUsername ||
                  client.custom_fields.instagram ||
                  client.custom_fields['instagram'] ||
                  null;
                
                if (instagram && typeof instagram === 'string') {
                  instagram = instagram.trim();
                }
              }
            }
            // Якщо custom_fields порожній або відсутній - instagram залишається null
            
            // Перевіряємо, чи Instagram валідний (не "no/ні", не порожній, не null)
            // ВАЖЛИВО: "no" / "ні" означає, що Instagram акаунту немає (явна відповідь).
            const invalidValues = ['no', 'ні', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];
            const originalInstagram = instagram; // Зберігаємо оригінальне значення для перевірки повідомлень
            const isExplicitNoInstagram =
              !!originalInstagram && ['no', 'ні'].includes(originalInstagram.toLowerCase().trim());
            if (instagram) {
              const lowerInstagram = instagram.toLowerCase().trim();
              if (invalidValues.includes(lowerInstagram)) {
                console.log(`[altegio/webhook] ⚠️ Instagram value "${instagram}" is invalid (considered as missing)`);
                instagram = null; // Вважаємо Instagram відсутнім
              }
            }
            
            // Синхронізуємо клієнта в будь-якому випадку (з Instagram або без)
            const isMissingInstagram = !instagram;
            const shouldSendNotification = isMissingInstagram && !isExplicitNoInstagram;
            
            if (instagram) {
              const normalizedInstagram = normalizeInstagram(instagram);
              if (normalizedInstagram) {
                const allStatuses = await getAllDirectStatuses();
                const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
                
                const existingDirectClients = await getAllDirectClients();
                const existingInstagramMap = new Map<string, string>();
                const existingAltegioIdMap = new Map<number, string>();
                
                for (const dc of existingDirectClients) {
                  const normalized = normalizeInstagram(dc.instagramUsername);
                  if (normalized) {
                    existingInstagramMap.set(normalized, dc.id);
                  }
                  if (dc.altegioClientId) {
                    existingAltegioIdMap.set(dc.altegioClientId, dc.id);
                  }
                }
                
                const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
                const firstName = nameParts[0] || undefined;
                const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
                
                let existingClientId = existingInstagramMap.get(normalizedInstagram);
                if (!existingClientId && client.id) {
                  existingClientId = existingAltegioIdMap.get(parseInt(String(client.id), 10));
                }
                
                if (existingClientId) {
                  const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
                  if (existingClient) {
                    // Оновлюємо дату запису з data.datetime, якщо вона є
                    // ВАЖЛИВО: встановлюємо paidServiceDate ТІЛЬКИ для платних послуг (НЕ консультацій)
                    const recordData = body.data?.data || body.data;
                    const appointmentDateTime = recordData?.datetime || data.datetime;
                    const services = recordData?.services || data.services || [];
                    const consultationInfo = isConsultationService(Array.isArray(services) ? services : []);
                    const hasConsultation = consultationInfo.isConsultation;
                    
                    let paidServiceDate = existingClient.paidServiceDate;
                    let signedUpForPaidService = existingClient.signedUpForPaidService;
                    
                    // Встановлюємо paidServiceDate ТІЛЬКИ якщо НЕ консультація
                    if (appointmentDateTime && !hasConsultation) {
                      const appointmentDate = new Date(appointmentDateTime);
                      const now = new Date();
                      if (appointmentDate > now || !paidServiceDate || new Date(paidServiceDate) < appointmentDate) {
                        paidServiceDate = appointmentDateTime;
                        signedUpForPaidService = true;
                      }
                    } else if (hasConsultation && !existingClient.signedUpForPaidService) {
                      // Для консультацій очищаємо paidServiceDate, якщо signedUpForPaidService = false
                      paidServiceDate = undefined;
                      signedUpForPaidService = false;
                    }
                    
                    const updated: typeof existingClient = {
                      ...existingClient,
                      altegioClientId: parseInt(String(client.id), 10),
                      instagramUsername: normalizedInstagram,
                      state: 'client' as const,
                      ...(firstName && { firstName }),
                      ...(lastName && { lastName }),
                      ...(paidServiceDate && { paidServiceDate }),
                      signedUpForPaidService,
                      updatedAt: new Date().toISOString(),
                    };
                    await saveDirectClient(updated);
                    console.log(`[altegio/webhook] ✅ Synced Direct client ${existingClientId} from record event (client ${client.id}, Instagram: ${normalizedInstagram})`);
                  }
                } else if (defaultStatus) {
                  const now = new Date().toISOString();
                  
                  // Автоматично призначаємо майстра, якщо є staff_id і послуга з нарощуванням
                  let masterId: string | undefined = undefined;
                  const recordData = body.data?.data || body.data;
                  const services = recordData?.services || data.services || [];
                  const staffId = recordData?.staff?.id || recordData?.staff_id;
                  const hasHairExtension = Array.isArray(services) && services.some((s: any) => {
                    const title = s.title || s.name || '';
                    return /нарощування/i.test(title);
                  });
                  
                  if (hasHairExtension && staffId) {
                    try {
                      const { getMasterByAltegioStaffId } = await import('@/lib/direct-masters/store');
                      const master = await getMasterByAltegioStaffId(staffId);
                      if (master) {
                        masterId = master.id;
                        console.log(`[altegio/webhook] Auto-assigned master ${master.name} (${master.id}) to new client from record event`);
                      }
                    } catch (err) {
                      console.warn(`[altegio/webhook] Failed to auto-assign master for staff_id ${staffId}:`, err);
                    }
                  }
                  
                  // Встановлюємо дату запису з data.datetime, якщо вона є і є майбутньою
                  // ВАЖЛИВО: встановлюємо paidServiceDate ТІЛЬКИ для платних послуг (НЕ консультацій)
                  const appointmentDateTime = recordData?.datetime || data.datetime;
                  const consultationInfo = isConsultationService(Array.isArray(services) ? services : []);
                  const hasConsultation = consultationInfo.isConsultation;
                  
                  let paidServiceDate: string | undefined = undefined;
                  let signedUpForPaidService = false;
                  
                  // Встановлюємо paidServiceDate ТІЛЬКИ якщо НЕ консультація
                  if (appointmentDateTime && !hasConsultation) {
                    const appointmentDate = new Date(appointmentDateTime);
                    const nowDate = new Date();
                    if (appointmentDate > nowDate) {
                      paidServiceDate = appointmentDateTime;
                      signedUpForPaidService = true;
                    }
                  }
                  
                  const newClient = {
                    id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    instagramUsername: normalizedInstagram,
                    firstName,
                    lastName,
                    source: 'instagram' as const,
                    state: 'client' as const,
                    firstContactDate: now,
                    statusId: defaultStatus.id,
                    masterId,
                    masterManuallySet: false, // Автоматичне призначення
                    visitedSalon: false,
                    signedUpForPaidService,
                    ...(paidServiceDate && { paidServiceDate }),
                    altegioClientId: parseInt(String(client.id), 10),
                    createdAt: now,
                    updatedAt: now,
                  };
                  await saveDirectClient(newClient);
                  console.log(`[altegio/webhook] ✅ Created Direct client ${newClient.id} from record event (client ${client.id}, Instagram: ${normalizedInstagram}, masterId: ${masterId || 'none'})`);
                }
              }
            } else if (isMissingInstagram) {
              // Якщо Instagram відсутній, перевіряємо чи існує клієнт з таким altegioClientId
              const allStatuses = await getAllDirectStatuses();
              const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
              
              if (defaultStatus) {
                const altegioClientId = parseInt(String(client.id), 10);
                
                // ВАЖЛИВО: Спочатку перевіряємо через getDirectClientByAltegioId (як в client events)
                const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
                const existingClientByAltegioId = await getDirectClientByAltegioId(altegioClientId);
                
                if (existingClientByAltegioId) {
                  // Якщо клієнт існує - використовуємо його Instagram username
                  let normalizedInstagram = existingClientByAltegioId.instagramUsername;
                  // Якщо в Altegio явно вказано "no/ні", то позначаємо це окремим токеном,
                  // щоб у таблиці було "NO INSTAGRAM", але без злиття клієнтів (унікальний username).
                  if (isExplicitNoInstagram && normalizedInstagram.startsWith('missing_instagram_')) {
                    normalizedInstagram = `no_instagram_${client.id}`;
                  }
                  const isMissingInstagramReal =
                    normalizedInstagram.startsWith('missing_instagram_') || normalizedInstagram.startsWith('no_instagram_');
                  
                  const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
                  const firstName = nameParts[0] || undefined;
                  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
                  
                  // Оновлюємо дату запису з data.datetime, якщо вона є
                  // ВАЖЛИВО: встановлюємо paidServiceDate ТІЛЬКИ для платних послуг (НЕ консультацій)
                  const recordData = body.data?.data || body.data;
                  const appointmentDateTime = recordData?.datetime || data.datetime;
                  const services = recordData?.services || data.services || [];
                  const consultationInfo = isConsultationService(Array.isArray(services) ? services : []);
                  const hasConsultation = consultationInfo.isConsultation;
                  
                  let paidServiceDate = existingClientByAltegioId.paidServiceDate;
                  let signedUpForPaidService = existingClientByAltegioId.signedUpForPaidService;
                  
                  // Встановлюємо paidServiceDate ТІЛЬКИ якщо НЕ консультація
                  if (appointmentDateTime && !hasConsultation) {
                    const appointmentDate = new Date(appointmentDateTime);
                    const now = new Date();
                    if (appointmentDate > now || !paidServiceDate || new Date(paidServiceDate) < appointmentDate) {
                      paidServiceDate = appointmentDateTime;
                      signedUpForPaidService = true;
                    }
                  } else if (hasConsultation && !existingClientByAltegioId.signedUpForPaidService) {
                    // Для консультацій очищаємо paidServiceDate, якщо signedUpForPaidService = false
                    paidServiceDate = undefined;
                    signedUpForPaidService = false;
                  }
                  
                  // Клієнти з Altegio завжди мають стан "client"
                  const clientState = 'client' as const;
                  
                  const updated = {
                    ...existingClientByAltegioId,
                    altegioClientId: altegioClientId, // Переконаємося, що altegioClientId встановлений
                    instagramUsername: normalizedInstagram, // Використовуємо існуючий Instagram
                    state: clientState,
                    ...(firstName && { firstName }),
                    ...(lastName && { lastName }),
                    ...(paidServiceDate && { paidServiceDate }),
                    signedUpForPaidService,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  await saveDirectClient(updated);
                  console.log(`[altegio/webhook] ✅ Updated Direct client ${existingClientByAltegioId.id} from record event (client ${client.id}, Instagram: ${normalizedInstagram}, state: ${clientState})`);
                } else {
                  // Клієнта не знайдено по altegioClientId - перевіряємо по імені та Instagram
                  const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
                  const firstName = nameParts[0] || '';
                  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
                  
                  // Шукаємо клієнта по імені (якщо воно вказане)
                  let existingClientByName: typeof existingClientByAltegioId = null;
                  if (firstName) {
                    const existingDirectClients = await getAllDirectClients();
                    
                    // Спочатку шукаємо за ім'ям + прізвищем (якщо обидва є)
                    if (lastName) {
                      existingClientByName = existingDirectClients.find((dc) => {
                        const dcFirstName = (dc.firstName || '').trim().toLowerCase();
                        const dcLastName = (dc.lastName || '').trim().toLowerCase();
                        const searchFirstName = firstName.trim().toLowerCase();
                        const searchLastName = lastName.trim().toLowerCase();
                        
                        return dcFirstName === searchFirstName && dcLastName === searchLastName;
                      }) || null;
                    }
                    
                    // Якщо не знайдено і є тільки ім'я (без прізвища), шукаємо за тільки ім'ям
                    if (!existingClientByName && !lastName) {
                      existingClientByName = existingDirectClients.find((dc) => {
                        const dcFirstName = (dc.firstName || '').trim().toLowerCase();
                        const dcLastName = (dc.lastName || '').trim().toLowerCase();
                        const searchFirstName = firstName.trim().toLowerCase();
                        
                        // Шукаємо за ім'ям, якщо прізвище відсутнє або порожнє
                        return dcFirstName === searchFirstName && (!dcLastName || dcLastName === '');
                      }) || null;
                    }
                    
                    if (existingClientByName) {
                      const foundByName = lastName ? `${firstName} ${lastName}` : firstName;
                      console.log(`[altegio/webhook] 🔍 Found existing client by name "${foundByName}": ${existingClientByName.id}, Instagram: ${existingClientByName.instagramUsername}, altegioClientId: ${existingClientByName.altegioClientId || 'none'}`);
                      
                      // Якщо знайдено клієнта по імені - використовуємо його Instagram username
                      const normalizedInstagram = existingClientByName.instagramUsername;
                      const isMissingInstagramReal =
                        normalizedInstagram.startsWith('missing_instagram_') || normalizedInstagram.startsWith('no_instagram_');
                      
                      // Оновлюємо дату запису з data.datetime, якщо вона є
                      // ВАЖЛИВО: встановлюємо paidServiceDate ТІЛЬКИ для платних послуг (НЕ консультацій)
                      const recordData = body.data?.data || body.data;
                      const appointmentDateTime = recordData?.datetime || data.datetime;
                      const services = recordData?.services || data.services || [];
                      const consultationInfo = isConsultationService(Array.isArray(services) ? services : []);
                      const hasConsultation = consultationInfo.isConsultation;
                      
                      let paidServiceDate = existingClientByName.paidServiceDate;
                      let signedUpForPaidService = existingClientByName.signedUpForPaidService;
                      
                      // Встановлюємо paidServiceDate ТІЛЬКИ якщо НЕ консультація
                      if (appointmentDateTime && !hasConsultation) {
                        const appointmentDate = new Date(appointmentDateTime);
                        const now = new Date();
                        if (appointmentDate > now || !paidServiceDate || new Date(paidServiceDate) < appointmentDate) {
                          paidServiceDate = appointmentDateTime;
                          signedUpForPaidService = true;
                        }
                      } else if (hasConsultation && !existingClientByName.signedUpForPaidService) {
                        // Для консультацій очищаємо paidServiceDate, якщо signedUpForPaidService = false
                        paidServiceDate = undefined;
                        signedUpForPaidService = false;
                      }
                      
                      // Встановлюємо altegioClientId, якщо його ще немає
                      const clientState = 'client' as const;
                      
                      const updated = {
                        ...existingClientByName,
                        altegioClientId: altegioClientId, // Встановлюємо altegioClientId
                        instagramUsername: normalizedInstagram, // Використовуємо існуючий Instagram
                        state: clientState,
                        ...(firstName && { firstName }),
                        ...(lastName && { lastName }),
                        ...(paidServiceDate && { paidServiceDate }),
                        signedUpForPaidService,
                        updatedAt: new Date().toISOString(),
                      };
                      
                      await saveDirectClient(updated);
                      console.log(`[altegio/webhook] ✅ Updated Direct client ${existingClientByName.id} from record event (found by name, client ${client.id}, Instagram: ${normalizedInstagram}, altegioClientId: ${altegioClientId}, state: ${clientState})`);
                      // Вихід - клієнта оновлено, не створюємо нового
                    }
                  }
                  
                  // Якщо клієнта не знайдено ні по altegioClientId, ні по імені - створюємо нового
                  if (!existingClientByName) {
                    const existingDirectClients = await getAllDirectClients();
                    const existingAltegioIdMap = new Map<number, string>();
                    
                    for (const dc of existingDirectClients) {
                      if (dc.altegioClientId) {
                        existingAltegioIdMap.set(dc.altegioClientId, dc.id);
                      }
                    }
                    
                    const existingClientId = existingAltegioIdMap.get(altegioClientId);
                    
                    if (!existingClientId) {
                      const now = new Date().toISOString();
                      const normalizedInstagram = isExplicitNoInstagram
                        ? `no_instagram_${client.id}`
                        : `missing_instagram_${client.id}`;
                      const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
                      const firstName = nameParts[0] || undefined;
                      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
                      
                      // Автоматично призначаємо майстра, якщо є staff_id і послуга з нарощуванням
                      let masterId: string | undefined = undefined;
                      const recordData = body.data?.data || body.data;
                      const services = recordData?.services || [];
                      const staffId = recordData?.staff?.id || recordData?.staff_id;
                      const hasHairExtension = Array.isArray(services) && services.some((s: any) => {
                        const title = s.title || s.name || '';
                        return /нарощування/i.test(title);
                      });
                      
                      if (hasHairExtension && staffId) {
                        try {
                          const { getMasterByAltegioStaffId } = await import('@/lib/direct-masters/store');
                          const master = await getMasterByAltegioStaffId(staffId);
                          if (master) {
                            masterId = master.id;
                            console.log(`[altegio/webhook] Auto-assigned master ${master.name} (${master.id}) to new client from record event`);
                          }
                        } catch (err) {
                          console.warn(`[altegio/webhook] Failed to auto-assign master for staff_id ${staffId}:`, err);
                        }
                      }
                      
                      const newClient = {
                        id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        instagramUsername: normalizedInstagram,
                        firstName,
                        lastName,
                        source: 'instagram' as const,
                        state: 'client' as const,
                        firstContactDate: now,
                        statusId: defaultStatus.id,
                        masterId,
                        masterManuallySet: false,
                        visitedSalon: false,
                        signedUpForPaidService: false,
                        altegioClientId: altegioClientId,
                        createdAt: now,
                        updatedAt: now,
                      };
                      await saveDirectClient(newClient);
                      console.log(`[altegio/webhook] ✅ Created Direct client ${newClient.id} from record event without Instagram (client ${client.id}, state: lead, masterId: ${masterId || 'none'})`);
                      
                      // ВАЖЛИВО: після saveDirectClient клієнт може бути об'єднаний з іншим через instagramUsername
                      // Перевіряємо, чи клієнт існує за altegioClientId перед відправкою повідомлення
                      const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
                      const savedClient = await getDirectClientByAltegioId(altegioClientId);
                      if (!savedClient) {
                        console.warn(`[altegio/webhook] ⚠️ Client with Altegio ID ${altegioClientId} not found after saveDirectClient - may have been merged or deleted. Skipping notification.`);
                      } else {
                  // Відправляємо повідомлення тільки якщо Instagram не був явно встановлений в "no/ні"
                  // і клієнт НЕ позначений як no_instagram_* (явно без Instagram).
                  const isSavedNoInstagram = normalizedInstagram?.startsWith('no_instagram_');
                  if (shouldSendNotification && !isSavedNoInstagram) {
                        try {
                          const { sendMessage } = await import('@/lib/telegram/api');
                          const { getAdminChatIds, getMykolayChatId } = await import('@/lib/direct-reminders/telegram');
                          const { listRegisteredChats } = await import('@/lib/photo-reports/master-registry');
                          const { TELEGRAM_ENV } = await import('@/lib/telegram/env');

                          let mykolayChatId = await getMykolayChatId();
                          if (!mykolayChatId) {
                            const registeredChats = await listRegisteredChats();
                            const mykolayChat = registeredChats.find(
                              chat => {
                                const username = chat.username?.toLowerCase().replace('@', '') || '';
                                return username === 'mykolay007';
                              }
                            );
                            mykolayChatId = mykolayChat?.chatId;
                          }

                          const adminChatIds = await getAdminChatIds();
                          // Виключаємо mykolayChatId з adminChatIds, щоб не дублювати повідомлення
                          const uniqueAdminChatIds = adminChatIds.filter(id => id !== mykolayChatId);
                          const clientName = (client.name || client.display_name || '').trim();
                          
                          // Перевіряємо, чи є ім'я (не відправляємо для клієнтів без імені)
                          // Перевіряємо різні варіанти "невідомого" імені
                          const clientNameLower = clientName.toLowerCase();
                          const isUnknownName = 
                            !clientName || 
                            clientName === 'Невідоме ім\'я' || 
                            clientName === 'Невідомий клієнт' ||
                            clientNameLower === 'невідоме ім\'я' ||
                            clientNameLower === 'невідомий клієнт' ||
                            clientNameLower.startsWith('невідом') ||
                            clientNameLower === 'unknown' ||
                            clientNameLower === 'немає імені';
                          
                          if (isUnknownName) {
                            console.log(`[altegio/webhook] ⏭️ Skipping notification for client ${client.id} - no name provided (name: "${clientName}")`);
                          } else {
                            const clientPhone = client.phone || 'не вказано';
                            const message = `⚠️ <b>Відсутній Instagram username</b>\n\n` +
                              `Клієнт: <b>${clientName}</b>\n` +
                              `Телефон: ${clientPhone}\n` +
                              `Altegio ID: <code>${client.id}</code>\n\n` +
                              `📝 <b>Відправте Instagram username у відповідь на це повідомлення</b>\n` +
                              `(наприклад: @username або username)\n\n` +
                              `Або відправте "ні", якщо у клієнта немає Instagram акаунту.\n\n` +
                              `Або додайте Instagram username для цього клієнта в Altegio.`;

                            const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;

                            let notificationSent = false;
                            if (mykolayChatId) {
                              try {
                                await sendMessage(mykolayChatId, message, {}, botToken);
                                console.log(`[altegio/webhook] ✅ Sent missing Instagram notification to mykolay007 (chatId: ${mykolayChatId})`);
                                notificationSent = true;
                                
                                // Логуємо вихідне повідомлення в KV
                                try {
                                  const { kvWrite } = await import('@/lib/kv');
                                  const logEntry = {
                                    type: 'outgoing',
                                    direction: 'outgoing',
                                    sentAt: new Date().toISOString(),
                                    chatId: mykolayChatId,
                                    altegioClientId: client.id,
                                    clientName: clientName,
                                    message: message,
                                    source: 'altegio-webhook',
                                  };
                                  await kvWrite.lpush('telegram:missing-instagram:outgoing', JSON.stringify(logEntry));
                                  await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
                                } catch (logErr) {
                                  console.error(`[altegio/webhook] Failed to log outgoing message:`, logErr);
                                }
                              } catch (err) {
                                console.error(`[altegio/webhook] ❌ Failed to send notification to mykolay007:`, err);
                              }
                            }

                            // Відправляємо адміністраторам (без mykolayChatId, щоб не дублювати)
                            for (const adminChatId of uniqueAdminChatIds) {
                              try {
                                await sendMessage(adminChatId, message, {}, botToken);
                                console.log(`[altegio/webhook] ✅ Sent missing Instagram notification to admin (chatId: ${adminChatId})`);
                                notificationSent = true;
                                
                                // Логуємо вихідне повідомлення в KV
                                try {
                                  const { kvWrite } = await import('@/lib/kv');
                                  const logEntry = {
                                    type: 'outgoing',
                                    direction: 'outgoing',
                                    sentAt: new Date().toISOString(),
                                    chatId: adminChatId,
                                    altegioClientId: client.id,
                                    clientName: clientName,
                                    message: message,
                                    source: 'altegio-webhook',
                                  };
                                  await kvWrite.lpush('telegram:missing-instagram:outgoing', JSON.stringify(logEntry));
                                  await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
                                } catch (logErr) {
                                  console.error(`[altegio/webhook] Failed to log outgoing message:`, logErr);
                                }
                              } catch (err) {
                                console.error(`[altegio/webhook] ❌ Failed to send notification to admin ${adminChatId}:`, err);
                              }
                            }
                            
                            // Оновлюємо клієнта, встановлюючи telegramNotificationSent = true
                            // ВАЖЛИВО: після saveDirectClient клієнт може бути об'єднаний з іншим через instagramUsername
                            // Тому шукаємо клієнта за altegioClientId, а не використовуємо newClient.id
                            if (notificationSent && altegioClientId) {
                              try {
                                const { prisma } = await import('@/lib/prisma');
                                const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
                                const directClient = await getDirectClientByAltegioId(altegioClientId);
                                if (directClient) {
                                  await prisma.directClient.update({
                                    where: { id: directClient.id },
                                    data: { telegramNotificationSent: true },
                                  });
                                  console.log(`[altegio/webhook] ✅ Updated telegramNotificationSent for client ${directClient.id} (Altegio ID: ${altegioClientId})`);
                                } else {
                                  console.warn(`[altegio/webhook] ⚠️ Client with Altegio ID ${altegioClientId} not found after saveDirectClient - may have been merged or deleted`);
                                }
                              } catch (updateErr) {
                                console.error(`[altegio/webhook] ❌ Failed to update telegramNotificationSent:`, updateErr);
                              }
                            }
                          }
                        } catch (notificationErr) {
                          console.error(`[altegio/webhook] ❌ Failed to send missing Instagram notifications:`, notificationErr);
                        }
                      } else if (['no', 'ні'].includes((originalInstagram || '').toLowerCase().trim())) {
                        console.log(`[altegio/webhook] ⏭️ Skipping notification for client ${client.id} from record event - Instagram explicitly set to \"no/ні\" (клієнт не має Instagram акаунту)`);
                      }
                      } // Закриваємо блок else для savedClient
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[altegio/webhook] ⚠️ Failed to sync client from record event:`, err);
            // Не зупиняємо обробку record події через помилку синхронізації клієнта
          }
        }

        // СТВОРЕННЯ НАГАДУВАНЬ ДЛЯ DIRECT КЛІЄНТІВ
        // Створюємо нагадування, якщо клієнт прийшов (attendance 1 або 2)
        if (data.attendance === 1 || data.attendance === 2 || data.visit_attendance === 1 || data.visit_attendance === 2) {
          try {
            const { getAllDirectClients } = await import('@/lib/direct-store');
            const { saveDirectReminder, getAllDirectReminders } = await import('@/lib/direct-reminders/store');
            const { calculateReminderDate, generateReminderId } = await import('@/lib/direct-reminders/utils');
            
            const clientId = data.client?.id ? parseInt(String(data.client.id), 10) : null;
            const visitDateTime = data.datetime;
            
            if (clientId && visitDateTime) {
              const directClients = await getAllDirectClients();
              const directClient = directClients.find(c => c.altegioClientId === clientId);
              
              if (directClient) {
                // Обчислюємо дату нагадування: 2 доби після візиту о 12:00 Київського часу
                const reminderDate = calculateReminderDate(visitDateTime);
                
                // Перевіряємо, чи вже є нагадування для цього візиту
                const existingReminders = await getAllDirectReminders();
                const existingReminder = existingReminders.find(
                  r => r.visitId === visitId && r.altegioClientId === clientId
                );
                
                if (!existingReminder) {
                  const firstService = Array.isArray(data.services) && data.services.length > 0
                    ? data.services[0]
                    : data.service || null;
                  const serviceName = firstService?.title || firstService?.name || 'Послуга';
                  
                  const reminder = {
                    id: generateReminderId(visitId, recordId),
                    directClientId: directClient.id,
                    altegioClientId: clientId,
                    visitId: visitId,
                    recordId: recordId,
                    instagramUsername: directClient.instagramUsername,
                    phone: data.client?.phone || undefined,
                    clientName: data.client?.display_name || data.client?.name || `${directClient.firstName || ''} ${directClient.lastName || ''}`.trim() || 'Клієнт',
                    visitDate: visitDateTime,
                    serviceName: serviceName,
                    status: 'pending' as const,
                    scheduledFor: reminderDate.toISOString(),
                    reminderCount: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  };
                  
                  await saveDirectReminder(reminder);
                  console.log(`[altegio/webhook] ✅ Created Direct reminder ${reminder.id} for client ${directClient.id} (visit ${visitId}, scheduled for ${reminderDate.toISOString()})`);
                } else {
                  console.log(`[altegio/webhook] ⏭️ Reminder already exists for visit ${visitId}, skipping`);
                }
              } else {
                console.log(`[altegio/webhook] ⏭️ Direct client not found for Altegio client ${clientId}, skipping reminder creation`);
              }
            }
          } catch (err) {
            console.error(`[altegio/webhook] ⚠️ Failed to create Direct reminder:`, err);
            // Не зупиняємо обробку record події через помилку створення нагадування
          }
        }

        // Оновлення або створення запису
        try {
          const datetime = data.datetime; // ISO string, наприклад "2025-11-28T17:00:00+02:00"
          if (!datetime) {
            console.log(`[altegio/webhook] ⏭️ Skipping visit ${visitId} - no datetime`);
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'no_datetime',
            });
          }

          const visitAt = new Date(datetime).getTime();
          const now = Date.now();

          // Якщо запис вже в минулому - не створюємо нагадування
          if (visitAt <= now) {
            console.log(
              `[altegio/webhook] ⏭️ Skipping past visit ${visitId} (datetime: ${datetime})`,
            );
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'past_visit',
            });
          }

          // Правила нагадувань
          const rules = await getActiveReminderRules();

          const client = data.client || {};
          
          // Детальне логування для діагностики
          console.log('[altegio/webhook] Client data:', {
            clientId: client.id,
            clientName: client.display_name || client.name,
            hasCustomFields: !!client.custom_fields,
            customFieldsKeys: client.custom_fields ? Object.keys(client.custom_fields) : [],
            customFields: client.custom_fields,
          });

          // Шукаємо Instagram username в custom_fields
          // ВАЖЛИВО: Altegio може повертати custom_fields як масив об'єктів з title/value
          let instagram: string | null = null;
          
          if (client.custom_fields) {
            // Варіант 1: custom_fields - це масив об'єктів (як в API)
            if (Array.isArray(client.custom_fields)) {
              for (const field of client.custom_fields) {
                if (field && typeof field === 'object') {
                  const title = field.title || field.name || field.label || '';
                  const value = field.value || field.data || field.content || field.text || '';
                  
                  // Шукаємо по title "Instagram user name"
                  if (value && typeof value === 'string' && /instagram/i.test(title)) {
                    instagram = value.trim();
                    break;
                  }
                }
              }
            }
            // Варіант 2: custom_fields - це об'єкт з ключами (як в деяких вебхуках)
            else if (typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
              instagram =
                client.custom_fields['instagram-user-name'] ||
                client.custom_fields['Instagram user name'] ||
                client.custom_fields.instagram_user_name ||
                client.custom_fields.instagramUsername ||
                client.custom_fields.instagram ||
                client.custom_fields['instagram'] ||
            null;
            }
          }

          // Якщо немає Instagram - не створюємо нагадування
          if (!instagram) {
            console.log(
              `[altegio/webhook] ⏭️ Skipping visit ${visitId} - no Instagram username`,
              {
                customFields: client.custom_fields,
                allClientKeys: Object.keys(client),
              },
            );
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'no_instagram',
            });
          }

          // ТЕСТОВИЙ РЕЖИМ: тільки для тестового клієнта
          const TEST_INSTAGRAM_USERNAME = 'mykolayyurashko';
          if (instagram.toLowerCase() !== TEST_INSTAGRAM_USERNAME.toLowerCase()) {
            console.log(
              `[altegio/webhook] ⏭️ Skipping visit ${visitId} - not test client (instagram: ${instagram})`,
            );
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'not_test_client',
            });
          }

          const visitJobsKey = `altegio:reminder:byVisit:${visitId}`;
          const existingJobIdsRaw = await kvRead.getRaw(visitJobsKey);
          const existingJobIds: string[] = existingJobIdsRaw
            ? JSON.parse(existingJobIdsRaw)
            : [];

          const newJobIds: string[] = [];

          // Для кожного правила створюємо/оновлюємо job
          console.log(`[altegio/webhook] Processing ${rules.length} rules for visit ${visitId}`, {
            datetime,
            visitAt: new Date(visitAt).toISOString(),
            now: new Date(now).toISOString(),
            daysUntilVisit: Math.round((visitAt - now) / (24 * 3600_000)),
          });

          for (const rule of rules) {
            const dueAt = calculateDueAt(datetime, rule.daysBefore);

            console.log(`[altegio/webhook] Rule ${rule.id} (${rule.daysBefore} days before):`, {
              dueAt: new Date(dueAt).toISOString(),
              now: new Date(now).toISOString(),
              visitAt: new Date(visitAt).toISOString(),
              isPast: dueAt <= now,
              diffMs: dueAt - now,
              diffHours: Math.round((dueAt - now) / (3600_000)),
            });

            // Якщо час вже пройшов - пропускаємо (щоб не спамити запізнілим)
            if (dueAt <= now) {
              console.log(
                `[altegio/webhook] ⏭️ Skipping rule ${rule.id} for visit ${visitId} - dueAt in past`,
                {
                  dueAt: new Date(dueAt).toISOString(),
                  now: new Date(now).toISOString(),
                  visitAt: new Date(visitAt).toISOString(),
                  daysBefore: rule.daysBefore,
                  diffMs: dueAt - now,
                },
              );
              continue;
            }

            const jobId = generateReminderJobId(visitId, rule.id);
            const jobKey = `altegio:reminder:job:${jobId}`;

            // Перевіряємо, чи вже є такий job
            const existingJobRaw = await kvRead.getRaw(jobKey);
            let job: ReminderJob;

            if (existingJobRaw) {
              // Оновлюємо існуючий job (наприклад, якщо перенесли дату)
              job = JSON.parse(existingJobRaw);
              job.datetime = datetime;
              job.dueAt = dueAt;
              job.updatedAt = Date.now();
              // Якщо job був canceled - відновлюємо його
              if (job.status === 'canceled') {
                job.status = 'pending';
                delete job.canceledAt;
              }
            } else {
              // Створюємо новий job
              job = {
                id: jobId,
                ruleId: rule.id,
                visitId: visitId,
                companyId: data.company_id || body.company_id || 0,
                clientId: client.id || 0,
                instagram: instagram,
                datetime: datetime,
                dueAt: dueAt,
                payload: {
                  clientName:
                    client.display_name || client.name || 'Клієнт',
                  phone: client.phone || null,
                  email: client.email || null,
                  serviceTitle: data.services?.[0]?.title || null,
                  staffName: data.staff?.name || null,
                },
                status: 'pending',
                attempts: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
            }

            // Зберігаємо job
            await kvWrite.setRaw(jobKey, JSON.stringify(job));
            newJobIds.push(jobId);

            // Додаємо в індекс для швидкого пошуку
            const indexKey = 'altegio:reminder:index';
            const indexRaw = await kvRead.getRaw(indexKey);
            let index: string[] = [];
            
            if (indexRaw) {
              try {
                const parsed = JSON.parse(indexRaw);
                if (Array.isArray(parsed)) {
                  index = parsed;
                } else {
                  console.warn('[altegio/webhook] Index is not an array, resetting:', typeof parsed, parsed);
                  // Скидаємо до порожнього масиву, якщо не масив
                  index = [];
                  await kvWrite.setRaw(indexKey, JSON.stringify(index));
                }
              } catch (err) {
                console.warn('[altegio/webhook] Failed to parse index:', err);
                // Скидаємо до порожнього масиву при помилці парсингу
                index = [];
                await kvWrite.setRaw(indexKey, JSON.stringify(index));
              }
            }
            
            if (!index.includes(jobId)) {
              index.push(jobId);
              await kvWrite.setRaw(indexKey, JSON.stringify(index));
              console.log(`[altegio/webhook] Added job ${jobId} to index, total: ${index.length}`);
            } else {
              console.log(`[altegio/webhook] Job ${jobId} already in index`);
            }
          }

          // Оновлюємо індекс по visitId
          await kvWrite.setRaw(visitJobsKey, JSON.stringify(newJobIds));

          console.log(
            `[altegio/webhook] ✅ Created/updated ${newJobIds.length} reminders for visit ${visitId}`,
          );
        } catch (err) {
          console.error(
            `[altegio/webhook] ❌ Failed to process ${status} for visit ${visitId}:`,
            err,
          );
        }
      }
    }

    // Обробка подій по клієнтах (client) для оновлення Direct Manager
    if (body.resource === 'client') {
      const clientId = body.resource_id;
      const status = body.status; // 'create', 'update', 'delete'
      const data = body.data || {};
      // ВАЖЛИВО: У реальних вебхуках структура може бути:
      // 1. data.client.custom_fields (тестові)
      // 2. data.custom_fields (реальні вебхуки від Altegio)
      const client = data.client || data || {};

      console.log('[altegio/webhook] Processing client event:', {
        clientId,
        status,
        hasClient: !!client,
        clientKeys: client ? Object.keys(client) : [],
        hasCustomFields: !!client.custom_fields,
        customFieldsType: typeof client.custom_fields,
        customFieldsIsArray: Array.isArray(client.custom_fields),
        customFields: client.custom_fields,
        dataStructure: {
          hasDataClient: !!data.client,
          hasDataCustomFields: !!data.custom_fields,
          dataKeys: Object.keys(data),
        },
      });

      // Оновлюємо клієнта в Direct Manager тільки при create/update
      if (status === 'create' || status === 'update') {
        try {
          // Імпортуємо функції для роботи з Direct Manager
          const { getAllDirectClients, getAllDirectStatuses, saveDirectClient } = await import('@/lib/direct-store');
          const { normalizeInstagram } = await import('@/lib/normalize');

          // Детальне логування структури даних
          console.log('[altegio/webhook] 🔍 Full client data structure:', {
            clientId,
            status,
            clientName: client.name || client.display_name,
            clientKeys: Object.keys(client),
            hasCustomFields: !!client.custom_fields,
            customFieldsType: typeof client.custom_fields,
            customFieldsIsArray: Array.isArray(client.custom_fields),
            customFieldsValue: client.custom_fields,
            fullClientData: JSON.stringify(client, null, 2),
          });

          // Витягуємо Instagram username (використовуємо ту саму логіку, що й вище)
          let instagram: string | null = null;
          
          if (client.custom_fields) {
            if (Array.isArray(client.custom_fields)) {
              console.log(`[altegio/webhook] 🔍 Processing custom_fields as array (length: ${client.custom_fields.length})`);
              for (const field of client.custom_fields) {
                if (field && typeof field === 'object') {
                  const title = field.title || field.name || field.label || '';
                  const value = field.value || field.data || field.content || field.text || '';
                  
                  console.log(`[altegio/webhook] 🔍 Checking field:`, { title, value, fieldKeys: Object.keys(field) });
                  
                  if (value && typeof value === 'string' && /instagram/i.test(title)) {
                    instagram = value.trim();
                    console.log(`[altegio/webhook] ✅ Found Instagram in array field: ${instagram} (title: ${title})`);
                    break;
                  }
                }
              }
            } else if (typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
              const customFieldsKeys = Object.keys(client.custom_fields);
              console.log(`[altegio/webhook] 🔍 Processing custom_fields as object (keys: ${customFieldsKeys.join(', ')})`);
              console.log(`[altegio/webhook] 🔍 Full custom_fields object:`, JSON.stringify(client.custom_fields, null, 2));
              
              // Перевіряємо різні варіанти ключів
              instagram =
                client.custom_fields['instagram-user-name'] ||
                client.custom_fields['Instagram user name'] ||
                client.custom_fields['Instagram username'] ||
                client.custom_fields.instagram_user_name ||
                client.custom_fields.instagramUsername ||
                client.custom_fields.instagram ||
                client.custom_fields['instagram'] ||
                null;
              
              // Якщо не знайшли по ключам, перевіряємо значення об'єкта (може бути вкладена структура)
              if (!instagram && customFieldsKeys.length > 0) {
                for (const key of customFieldsKeys) {
                  const value = client.custom_fields[key];
                  if (value && typeof value === 'string' && value.trim()) {
                    // Якщо ключ містить "instagram", беремо значення
                    if (/instagram/i.test(key)) {
                      instagram = value.trim();
                      console.log(`[altegio/webhook] ✅ Found Instagram by key "${key}": ${instagram}`);
                      break;
                    }
                  } else if (value && typeof value === 'object') {
                    // Якщо значення - об'єкт, шукаємо в ньому
                    const nestedValue = value.value || value.data || value.content || value.text;
                    if (nestedValue && typeof nestedValue === 'string' && /instagram/i.test(key)) {
                      instagram = nestedValue.trim();
                      console.log(`[altegio/webhook] ✅ Found Instagram in nested object by key "${key}": ${instagram}`);
                      break;
                    }
                  }
                }
              }
              
              if (instagram) {
                console.log(`[altegio/webhook] ✅ Found Instagram in object field: ${instagram}`);
              } else if (customFieldsKeys.length > 0) {
                console.log(`[altegio/webhook] ⚠️ custom_fields object has keys but no Instagram found:`, customFieldsKeys);
              }
            }
          } else {
            console.log(`[altegio/webhook] ⚠️ No custom_fields found in client data`);
          }

          // Перевіряємо, чи Instagram валідний (не "no/ні", не порожній, не null)
          // ВАЖЛИВО: "no" / "ні" означає, що Instagram акаунту немає (явна відповідь).
          const invalidValues = ['no', 'ні', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];
          const isExplicitNoInstagram = !!instagram && ['no', 'ні'].includes(instagram.toLowerCase().trim());
          if (instagram) {
            const lowerInstagram = instagram.toLowerCase().trim();
            if (invalidValues.includes(lowerInstagram)) {
              console.log(`[altegio/webhook] ⚠️ Instagram value "${instagram}" is invalid (considered as missing)`);
              instagram = null; // Вважаємо Instagram відсутнім
            }
          }

          // Спочатку перевіряємо, чи є збережений зв'язок altegio_client_id -> instagram_username
          let normalizedInstagram: string | null = null;
          let isMissingInstagram = false;
          let usingSavedLink = false;

          // Перевіряємо, чи існує клієнт з таким altegioClientId
          const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
          const existingClientByAltegioId = await getDirectClientByAltegioId(parseInt(String(clientId), 10));
          
          if (existingClientByAltegioId) {
            // Якщо клієнт існує, але в webhook є новий Instagram - використовуємо його (пріоритет webhook'у)
            if (instagram) {
              const normalizedFromWebhook = normalizeInstagram(instagram);
              if (normalizedFromWebhook) {
                normalizedInstagram = normalizedFromWebhook;
                isMissingInstagram = false;
                console.log(`[altegio/webhook] ✅ Found Instagram in webhook for existing client ${clientId}: ${normalizedInstagram} (updating from ${existingClientByAltegioId.instagramUsername})`);
              } else {
                // Якщо Instagram з webhook'а невалідний, використовуємо старий
                normalizedInstagram = existingClientByAltegioId.instagramUsername;
                isMissingInstagram = normalizedInstagram.startsWith('missing_instagram_') || normalizedInstagram.startsWith('no_instagram_');
                console.log(`[altegio/webhook] ⚠️ Invalid Instagram in webhook for client ${clientId}, keeping existing: ${normalizedInstagram}`);
              }
            } else {
              // Якщо в webhook немає Instagram, використовуємо існуючий
              normalizedInstagram = existingClientByAltegioId.instagramUsername;
              isMissingInstagram = normalizedInstagram.startsWith('missing_instagram_') || normalizedInstagram.startsWith('no_instagram_');
              usingSavedLink = true;
              console.log(`[altegio/webhook] ✅ Using saved Instagram link for client ${clientId}: ${normalizedInstagram}`);
            }

            // Якщо в Altegio явно вказано "no/ні", позначаємо це як no_instagram_* (унікально),
            // щоб у таблиці показувати "NO INSTAGRAM" без злиття клієнтів.
            if (isExplicitNoInstagram && normalizedInstagram && normalizedInstagram.startsWith('missing_instagram_')) {
              normalizedInstagram = `no_instagram_${clientId}`;
              isMissingInstagram = true;
            }
          } else {
            // Клієнта не знайдено - обробляємо Instagram з вебхука
            if (!instagram) {
              console.log(`[altegio/webhook] ⚠️ No Instagram username for client ${clientId}, creating with temporary username`);
              isMissingInstagram = true;
              normalizedInstagram = isExplicitNoInstagram ? `no_instagram_${clientId}` : `missing_instagram_${clientId}`;
            } else {
              console.log(`[altegio/webhook] ✅ Extracted Instagram for new client ${clientId}: ${instagram}`);
              normalizedInstagram = normalizeInstagram(instagram);
              if (!normalizedInstagram) {
                console.log(`[altegio/webhook] ⚠️ Invalid Instagram username for client ${clientId}: ${instagram}, creating with temporary username`);
                isMissingInstagram = true;
                normalizedInstagram = isExplicitNoInstagram ? `no_instagram_${clientId}` : `missing_instagram_${clientId}`;
              } else {
                isMissingInstagram = false;
                console.log(`[altegio/webhook] ✅ Normalized Instagram for new client ${clientId}: ${normalizedInstagram}`);
              }
            }
          }

          // Отримуємо статус за замовчуванням
          const allStatuses = await getAllDirectStatuses();
          const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
          if (!defaultStatus) {
            console.error(`[altegio/webhook] ❌ No default status found, cannot create client`);
            return NextResponse.json({
              ok: true,
              received: true,
              error: 'No default status found',
            });
          }

          console.log(`[altegio/webhook] ✅ Using default status: ${defaultStatus.id} (${defaultStatus.name})`);

          // Отримуємо існуючих клієнтів для перевірки дублікатів
          const existingDirectClients = await getAllDirectClients();
          const existingInstagramMap = new Map<string, string>();
          const existingAltegioIdMap = new Map<number, string>();
          
          for (const dc of existingDirectClients) {
            const normalized = normalizeInstagram(dc.instagramUsername);
            if (normalized) {
              existingInstagramMap.set(normalized, dc.id);
            }
            if (dc.altegioClientId) {
              existingAltegioIdMap.set(dc.altegioClientId, dc.id);
            }
          }

          // Витягуємо ім'я
          const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
          const firstName = nameParts[0] || undefined;
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

          // Витягуємо телефон з Altegio
          const phoneFromAltegio = client.phone ? String(client.phone).trim() : undefined;

          // Шукаємо існуючого клієнта
          let existingClientId = existingInstagramMap.get(normalizedInstagram);
          let existingClientIdByAltegio = clientId ? existingAltegioIdMap.get(parseInt(String(clientId), 10)) : null;
          
          // Перевіряємо, чи потрібно об'єднати два записи:
          // 1. Запис з real Instagram username (можливо без altegioClientId)
          // 2. Запис з missing_instagram_* та altegioClientId
          let duplicateClientId: string | null = null;
          
          if (existingClientId && existingClientIdByAltegio && existingClientId !== existingClientIdByAltegio) {
            // Знайдено два різні записи - потрібно об'єднати
            const clientByInstagram = existingDirectClients.find((c) => c.id === existingClientId);
            const clientByAltegio = existingDirectClients.find((c) => c.id === existingClientIdByAltegio);
            
            if (clientByInstagram && clientByAltegio) {
              const hasRealInstagram =
                !clientByInstagram.instagramUsername.startsWith('missing_instagram_') &&
                !clientByInstagram.instagramUsername.startsWith('no_instagram_');
              const hasMissingInstagram =
                clientByAltegio.instagramUsername.startsWith('missing_instagram_') ||
                clientByAltegio.instagramUsername.startsWith('no_instagram_');
              
              // ВАЖЛИВО: завжди залишаємо клієнта з Altegio (той, що має altegioClientId)
              // Це гарантує, що ім'я, прізвище та телефон будуть з Altegio
              if (hasRealInstagram && hasMissingInstagram) {
                // Об'єднуємо: залишаємо клієнта з Altegio (missing_instagram_*), видаляємо з ManyChat (real Instagram)
                // Instagram username буде оновлено на реальний з ManyChat клієнта
                console.log(`[altegio/webhook] 🔄 Found duplicate clients: ${existingClientId} (real Instagram from ManyChat) and ${existingClientIdByAltegio} (Altegio client), merging...`);
                console.log(`[altegio/webhook] 🔄 MERGE STRATEGY: Keeping Altegio client ${existingClientIdByAltegio}, deleting ManyChat client ${existingClientId}`);
                duplicateClientId = existingClientId; // Видаляємо ManyChat клієнта
                existingClientId = existingClientIdByAltegio; // Залишаємо Altegio клієнта
              } else if (!hasRealInstagram && hasMissingInstagram) {
                // Об'єднуємо: залишаємо клієнта з altegioClientId, видаляємо інший
                console.log(`[altegio/webhook] 🔄 Found duplicate clients: ${existingClientIdByAltegio} (has altegioClientId) and ${existingClientId} (no altegioClientId), merging...`);
                duplicateClientId = existingClientId;
                existingClientId = existingClientIdByAltegio;
              }
            }
          } else if (!existingClientId && existingClientIdByAltegio) {
            // Знайдено тільки за altegioClientId
            existingClientId = existingClientIdByAltegio;
          }

          if (existingClientId) {
            // Оновлюємо існуючого клієнта
            const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
            if (existingClient) {
              // Встановлюємо стан "client" (стан "lead" більше не використовується)
              const clientState = 'client' as const;
              
              // ВАЖЛИВО: Оновлюємо ім'я з Altegio тільки якщо:
              // 1. Клієнт ще не має altegioClientId (перший раз отримуємо дані з Altegio)
              // 2. АБО ім'я відсутнє/порожнє (заповнюємо порожні поля)
              const shouldUpdateName = !existingClient.altegioClientId || !existingClient.firstName || !existingClient.lastName;
              
              const updated: typeof existingClient = {
                ...existingClient,
                altegioClientId: parseInt(String(clientId), 10),
                instagramUsername: normalizedInstagram,
                state: clientState,
                ...(shouldUpdateName && firstName && { firstName }),
                ...(shouldUpdateName && lastName && { lastName }),
                ...(phoneFromAltegio && { phone: phoneFromAltegio }), // Додаємо телефон з Altegio
                updatedAt: new Date().toISOString(),
              };
              
              await saveDirectClient(updated);
              console.log(`[altegio/webhook] ✅ Updated Direct client ${existingClientId} from Altegio client ${clientId} (Instagram: ${normalizedInstagram}, state: ${clientState})`);
              
              // Видаляємо дублікат, якщо він є
              if (duplicateClientId) {
                try {
                  // Переносимо історію повідомлень та станів з ManyChat клієнта до Altegio клієнта (якщо потрібно)
                  try {
                    const { moveClientHistory } = await import('@/lib/direct-store');
                    const moved = await moveClientHistory(duplicateClientId, existingClientId);
                    if (moved.movedMessages > 0 || moved.movedStateLogs > 0) {
                      console.log(`[altegio/webhook] ✅ Перенесено історію з ${duplicateClientId} → ${existingClientId}: messages=${moved.movedMessages}, stateLogs=${moved.movedStateLogs}`);
                    }
                  } catch (historyErr) {
                    console.warn('[altegio/webhook] ⚠️ Не вдалося перенести історію повідомлень/станів (не критично):', historyErr);
                  }
                  
                  // Переносимо аватарку з ManyChat клієнта до Altegio клієнта (якщо вона є)
                  try {
                    const duplicateClient = existingDirectClients.find((c) => c.id === duplicateClientId);
                    if (duplicateClient) {
                      const { kvRead, kvWrite } = await import('@/lib/kv');
                      const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
                      const oldUsername = duplicateClient.instagramUsername;
                      const newUsername = normalizedInstagram;
                      
                      if (oldUsername && oldUsername !== newUsername && 
                          !oldUsername.startsWith('missing_instagram_') && 
                          !oldUsername.startsWith('no_instagram_') &&
                          !newUsername.startsWith('missing_instagram_') &&
                          !newUsername.startsWith('no_instagram_')) {
                        const oldKey = directAvatarKey(oldUsername);
                        const newKey = directAvatarKey(newUsername);
                        
                        try {
                          const oldAvatar = await kvRead.getRaw(oldKey);
                          if (oldAvatar && typeof oldAvatar === 'string' && /^https?:\/\//i.test(oldAvatar.trim())) {
                            // Перевіряємо, чи вже є аватарка для нового username
                            const existingNewAvatar = await kvRead.getRaw(newKey);
                            if (!existingNewAvatar || typeof existingNewAvatar !== 'string' || !/^https?:\/\//i.test(existingNewAvatar.trim())) {
                              // Копіюємо аватарку на новий ключ
                              await kvWrite.setRaw(newKey, oldAvatar);
                              console.log(`[altegio/webhook] ✅ Перенесено аватарку з "${oldUsername}" → "${newUsername}"`);
                            } else {
                              console.log(`[altegio/webhook] ℹ️ Аватарка для "${newUsername}" вже існує, не перезаписуємо`);
                            }
                          }
                        } catch (avatarErr) {
                          console.warn('[altegio/webhook] ⚠️ Не вдалося перенести аватарку (не критично):', avatarErr);
                        }
                      }
                    }
                  } catch (avatarErr) {
                    console.warn('[altegio/webhook] ⚠️ Помилка при спробі перенести аватарку (не критично):', avatarErr);
                  }
                  
                  const { deleteDirectClient } = await import('@/lib/direct-store');
                  await deleteDirectClient(duplicateClientId);
                  console.log(`[altegio/webhook] ✅ Deleted duplicate client ${duplicateClientId} after merging`);
                } catch (deleteErr) {
                  console.error(`[altegio/webhook] ❌ Failed to delete duplicate client ${duplicateClientId}:`, deleteErr);
                }
              }
            }
          } else {
            // Створюємо нового клієнта
            const now = new Date().toISOString();
            // Клієнти з Altegio завжди мають стан "client" (не можуть бути "lead")
            // Бо Altegio - це клієнтська база, там лише клієнти, а не ліди
            const clientState = 'client' as const;
            
            // Спробуємо отримати lastVisitAt з Altegio API
            let lastVisitAt: string | undefined = undefined;
            try {
              const { getClient } = await import('@/lib/altegio/clients');
              const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
              const companyId = parseInt(companyIdStr, 10);
              if (companyId && !Number.isNaN(companyId)) {
                const altegioClient = await getClient(companyId, parseInt(String(clientId), 10));
                const raw = (altegioClient as any)?.last_visit_date ?? (altegioClient as any)?.lastVisitDate ?? null;
                const s = raw ? String(raw).trim() : '';
                if (s) {
                  const d = new Date(s);
                  if (!isNaN(d.getTime())) {
                    lastVisitAt = d.toISOString();
                  }
                }
              }
            } catch (err) {
              console.warn('[altegio/webhook] ⚠️ Не вдалося витягнути lastVisitAt при створенні клієнта (не критично):', err);
            }
            
            const newClient = {
              id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              instagramUsername: normalizedInstagram,
              firstName,
              lastName,
              ...(phoneFromAltegio && { phone: phoneFromAltegio }), // Додаємо телефон з Altegio
              ...(lastVisitAt && { lastVisitAt }), // Додаємо lastVisitAt з Altegio
              source: 'instagram' as const,
              state: clientState,
              firstContactDate: now,
              statusId: defaultStatus.id, // Використовуємо ID статусу за замовчуванням
              visitedSalon: false,
              signedUpForPaidService: false,
              altegioClientId: parseInt(String(clientId), 10),
              createdAt: now,
              updatedAt: now,
            };
            await saveDirectClient(newClient);
            if ((newClient as any).lastVisitAt) pushLastVisitAtUpdate(newClient.id, (newClient as any).lastVisitAt).catch(() => {});
            console.log(`[altegio/webhook] ✅ Created Direct client ${newClient.id} from Altegio client ${clientId} (Instagram: ${normalizedInstagram}, state: ${clientState}, statusId: ${defaultStatus.id})`);

            // ВАЖЛИВО: після saveDirectClient клієнт може бути об'єднаний з іншим через instagramUsername
            // Перевіряємо, чи клієнт існує за altegioClientId перед подальшими операціями
            const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
            const savedClient = await getDirectClientByAltegioId(newClient.altegioClientId);
            if (!savedClient) {
              console.warn(`[altegio/webhook] ⚠️ Client with Altegio ID ${newClient.altegioClientId} not found after saveDirectClient - may have been merged or deleted. Skipping notification and further operations.`);
              // Продовжуємо обробку вебхука, але не відправляємо повідомлення та не виконуємо подальші операції
              // (клієнт може бути об'єднаний, але altegioClientId не встановлено в об'єднаному клієнті)
            } else {

            // Якщо lastVisitAt відсутній, але є altegioClientId, спробуємо синхронізувати
            if (!lastVisitAt && savedClient.altegioClientId) {
              try {
                const syncedLastVisitAt = await syncLastVisitAtFromAltegio(savedClient.altegioClientId);
                if (syncedLastVisitAt) {
                  const clientWithLastVisit = {
                    ...savedClient,
                    lastVisitAt: syncedLastVisitAt,
                    updatedAt: savedClient.updatedAt, // Не рухаємо updatedAt
                  };
                  await saveDirectClient(clientWithLastVisit, 'altegio-webhook-sync-last-visit', { altegioClientId: savedClient.altegioClientId }, { touchUpdatedAt: false, skipAltegioMetricsSync: true });
                  if (clientWithLastVisit.lastVisitAt) pushLastVisitAtUpdate(clientWithLastVisit.id, clientWithLastVisit.lastVisitAt).catch(() => {});
                  console.log(`[altegio/webhook] ✅ Synced lastVisitAt for client ${savedClient.id}: ${syncedLastVisitAt}`);
                }
              } catch (err) {
                console.warn(`[altegio/webhook] ⚠️ Не вдалося синхронізувати lastVisitAt для клієнта ${savedClient.id} (не критично):`, err);
              }
            }

            // Якщо створено клієнта без Instagram, відправляємо повідомлення
            // АЛЕ: якщо Instagram = "no", не відправляємо повідомлення (бо "no" означає, що у клієнтки немає Instagram)
            const isSavedNoInstagram = (normalizedInstagram || '').startsWith('no_instagram_');
            const shouldSendNotification =
              isMissingInstagram &&
              !isSavedNoInstagram &&
              !['no', 'ні'].includes((instagram || '').toLowerCase().trim());
            if (shouldSendNotification) {
              try {
                const { sendMessage } = await import('@/lib/telegram/api');
                const { getAdminChatIds, getMykolayChatId } = await import('@/lib/direct-reminders/telegram');
                const { listRegisteredChats } = await import('@/lib/photo-reports/master-registry');
                const { TELEGRAM_ENV } = await import('@/lib/telegram/env');

                // Отримуємо chat ID для mykolay007 (спочатку через функцію, потім через username)
                let mykolayChatId = await getMykolayChatId();
                if (!mykolayChatId) {
                  // Якщо не знайдено через функцію, шукаємо за username
                  const registeredChats = await listRegisteredChats();
                  const mykolayChat = registeredChats.find(
                    chat => {
                      const username = chat.username?.toLowerCase().replace('@', '') || '';
                      return username === 'mykolay007';
                    }
                  );
                  mykolayChatId = mykolayChat?.chatId;
                }

                // Отримуємо chat ID адміністраторів
                const adminChatIds = await getAdminChatIds();
                // Виключаємо mykolayChatId з adminChatIds, щоб не дублювати повідомлення
                const uniqueAdminChatIds = adminChatIds.filter(id => id !== mykolayChatId);

                // Формуємо повідомлення
                const clientName = (client.name || client.display_name || '').trim();
                
                // Перевіряємо, чи є ім'я (не відправляємо для клієнтів без імені)
                // Перевіряємо різні варіанти "невідомого" імені
                const clientNameLower = clientName.toLowerCase();
                const isUnknownName = 
                  !clientName || 
                  clientName === 'Невідоме ім\'я' || 
                  clientName === 'Невідомий клієнт' ||
                  clientNameLower === 'невідоме ім\'я' ||
                  clientNameLower === 'невідомий клієнт' ||
                  clientNameLower.startsWith('невідом') ||
                  clientNameLower === 'unknown' ||
                  clientNameLower === 'немає імені';
                
                if (isUnknownName) {
                  console.log(`[altegio/webhook] ⏭️ Skipping notification for client ${clientId} - no name provided (name: "${clientName}")`);
                } else {
                  const clientPhone = client.phone || 'не вказано';
                  const message = `⚠️ <b>Відсутній Instagram username</b>\n\n` +
                    `Клієнт: <b>${clientName}</b>\n` +
                    `Телефон: ${clientPhone}\n` +
                    `Altegio ID: <code>${clientId}</code>\n\n` +
                    `📝 <b>Відправте Instagram username у відповідь на це повідомлення</b>\n` +
                    `(наприклад: @username або username)\n\n` +
                    `Або відправте "ні", якщо у клієнта немає Instagram акаунту.\n\n` +
                    `Або додайте Instagram username для цього клієнта в Altegio.`;

                  // Отримуємо токен бота
                  const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;

                  let notificationSent = false;
                  // Відправляємо повідомлення mykolay007
                  if (mykolayChatId) {
                    try {
                      await sendMessage(mykolayChatId, message, {}, botToken);
                      console.log(`[altegio/webhook] ✅ Sent missing Instagram notification to mykolay007 (chatId: ${mykolayChatId})`);
                      notificationSent = true;
                      
                      // Логуємо вихідне повідомлення в KV
                      try {
                        const { kvWrite } = await import('@/lib/kv');
                        const logEntry = {
                          type: 'outgoing',
                          direction: 'outgoing',
                          sentAt: new Date().toISOString(),
                          chatId: mykolayChatId,
                          altegioClientId: clientId,
                          clientName: clientName,
                          message: message,
                          source: 'altegio-webhook',
                        };
                        await kvWrite.lpush('telegram:missing-instagram:outgoing', JSON.stringify(logEntry));
                        await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
                      } catch (logErr) {
                        console.error(`[altegio/webhook] Failed to log outgoing message:`, logErr);
                      }
                    } catch (err) {
                      console.error(`[altegio/webhook] ❌ Failed to send notification to mykolay007:`, err);
                    }
                  } else {
                    console.warn(`[altegio/webhook] ⚠️ mykolay007 chat ID not found`);
                  }

                  // Відправляємо повідомлення адміністраторам (без mykolayChatId, щоб не дублювати)
                  for (const adminChatId of uniqueAdminChatIds) {
                    try {
                      await sendMessage(adminChatId, message, {}, botToken);
                      console.log(`[altegio/webhook] ✅ Sent missing Instagram notification to admin (chatId: ${adminChatId})`);
                      notificationSent = true;
                      
                      // Логуємо вихідне повідомлення в KV
                      try {
                        const { kvWrite } = await import('@/lib/kv');
                        const logEntry = {
                          type: 'outgoing',
                          direction: 'outgoing',
                          sentAt: new Date().toISOString(),
                          chatId: adminChatId,
                          altegioClientId: clientId,
                          clientName: clientName,
                          message: message,
                          source: 'altegio-webhook',
                        };
                        await kvWrite.lpush('telegram:missing-instagram:outgoing', JSON.stringify(logEntry));
                        await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
                      } catch (logErr) {
                        console.error(`[altegio/webhook] Failed to log outgoing message:`, logErr);
                      }
                    } catch (err) {
                      console.error(`[altegio/webhook] ❌ Failed to send notification to admin ${adminChatId}:`, err);
                    }
                  }
                  
                  // Оновлюємо клієнта, встановлюючи telegramNotificationSent = true
                  if (notificationSent && clientId) {
                    try {
                      const { prisma } = await import('@/lib/prisma');
                      const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
                      const directClient = await getDirectClientByAltegioId(clientId);
                      if (directClient) {
                        await prisma.directClient.update({
                          where: { id: directClient.id },
                          data: { telegramNotificationSent: true },
                        });
                        console.log(`[altegio/webhook] ✅ Updated telegramNotificationSent for client ${directClient.id} (Altegio ID: ${clientId})`);
                      }
                    } catch (updateErr) {
                      console.error(`[altegio/webhook] ❌ Failed to update telegramNotificationSent:`, updateErr);
                    }
                  }
                }
              } catch (notificationErr) {
                console.error(`[altegio/webhook] ❌ Failed to send missing Instagram notifications:`, notificationErr);
                // Не блокуємо обробку вебхука, якщо не вдалося відправити повідомлення
              }
            } else if (isMissingInstagram && ['no', 'ні'].includes((instagram || '').toLowerCase().trim())) {
              console.log(`[altegio/webhook] ⏭️ Skipping notification for client ${clientId} - Instagram explicitly set to "no/ні" (клієнт не має Instagram акаунту)`);
            }
            } // Закриваємо блок else для savedClient
          }

          return NextResponse.json({
            ok: true,
            received: true,
            processed: true,
            clientId,
            instagram: normalizedInstagram,
            missingInstagram: isMissingInstagram,
          });
        } catch (err) {
          console.error(`[altegio/webhook] ❌ Failed to process client event ${clientId}:`, err);
          console.error(`[altegio/webhook] ❌ Error stack:`, err instanceof Error ? err.stack : 'No stack trace');
          return NextResponse.json({
            ok: true,
            received: true,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return NextResponse.json({
        ok: true,
        received: true,
        skipped: `client_${status}`,
      });
    }

    // Повертаємо успішну відповідь
    return NextResponse.json({
      ok: true,
      received: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[altegio/webhook] Error processing webhook:', error);
    
    // Важливо: повертаємо 200 OK навіть при помилці,
    // щоб Altegio не намагався повторно надсилати webhook
    return NextResponse.json({ 
      ok: false, 
      error: error instanceof Error ? error.message : String(error),
    }, { status: 200 });
  }
}

// GET для перевірки, що endpoint працює
export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;

    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, limit - 1);
    const events = rawItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return { raw };
        }
      })
      .filter(Boolean);

    // Шукаємо останні події по record
    const recordEvents = events
      .filter((e: any) => e.body?.resource === 'record')
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        status: e.body?.status,
        visitId: e.body?.resource_id,
        datetime: e.body?.data?.datetime,
        serviceId: e.body?.data?.service?.id || e.body?.data?.service_id,
        serviceName: e.body?.data?.service?.title || e.body?.data?.service?.name || 'Невідома послуга',
        staffId: e.body?.data?.staff?.id || e.body?.data?.staff_id,
        staffName: e.body?.data?.staff?.name || e.body?.data?.staff?.display_name || 'Невідомий майстер',
        clientId: e.body?.data?.client?.id,
        clientName: e.body?.data?.client?.display_name || e.body?.data?.client?.name,
        fullBody: e.body,
      }));

    // Отримуємо record events з records log (які ми зберігаємо для статистики)
    let savedRecords: any[] = [];
    try {
      const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, limit - 1);
      savedRecords = recordsLogRaw
        .map((raw) => {
          try {
            const parsed = JSON.parse(raw);
            // Upstash може повертати елементи як { value: "..." }
            if (
              parsed &&
              typeof parsed === 'object' &&
              'value' in parsed &&
              typeof parsed.value === 'string'
            ) {
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
        .filter((r) => r && r.visitId && r.datetime);
    } catch (err) {
      console.warn('[webhook GET] Failed to read records log:', err);
    }

    // Шукаємо останні події по client
    const clientEvents = events
      .filter((e: any) => e.body?.resource === 'client')
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        status: e.body?.status,
        clientId: e.body?.resource_id,
        clientName: e.body?.data?.client?.name || e.body?.data?.client?.display_name || e.body?.data?.name,
        hasCustomFields: !!e.body?.data?.client?.custom_fields || !!e.body?.data?.custom_fields,
        customFieldsType: e.body?.data?.client?.custom_fields 
          ? typeof e.body?.data?.client?.custom_fields 
          : e.body?.data?.custom_fields 
            ? typeof e.body?.data?.custom_fields 
            : 'undefined',
        customFieldsIsArray: Array.isArray(e.body?.data?.client?.custom_fields) || Array.isArray(e.body?.data?.custom_fields),
        customFields: e.body?.data?.client?.custom_fields || e.body?.data?.custom_fields,
        fullBody: e.body,
      }));

    // Знаходимо останній record event
    const lastRecordEvent = recordEvents.length > 0
      ? recordEvents[0]
      : savedRecords.length > 0
        ? {
            visitId: savedRecords[0].visitId,
            datetime: savedRecords[0].datetime,
            serviceId: savedRecords[0].serviceId,
            serviceName: savedRecords[0].serviceName,
            staffId: savedRecords[0].staffId,
            receivedAt: savedRecords[0].receivedAt,
            status: 'saved',
          }
        : null;

    // Знаходимо останню client event
    const lastClientEvent = clientEvents.length > 0 ? clientEvents[0] : null;

    return NextResponse.json({
      ok: true,
      message: 'Altegio webhook endpoint is active',
      timestamp: new Date().toISOString(),
      eventsCount: events.length,
      recordEventsCount: recordEvents.length,
      clientEventsCount: clientEvents.length,
      savedRecordsCount: savedRecords.length,
      lastRecordEvent: lastRecordEvent,
      lastClientEvent: lastClientEvent,
      lastRecordEvents: recordEvents.slice(0, 10),
      lastClientEvents: clientEvents.slice(0, 10),
      savedRecords: savedRecords.slice(0, 10),
      allEvents: events.slice(0, 5), // Перші 5 для діагностики
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Failed to read webhook log',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
