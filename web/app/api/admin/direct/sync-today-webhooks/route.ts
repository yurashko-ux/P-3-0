// web/app/api/admin/direct/sync-today-webhooks/route.ts
// Обробка сьогоднішніх вебхуків від Altegio для синхронізації клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * POST - обробити вебхуки від Altegio за вказану дату або останні N днів
 * Параметри в body:
 *   - date (опціонально): дата в форматі YYYY-MM-DD, за замовчуванням - сьогодні
 *   - days (опціонально): кількість днів назад (1 = сьогодні, 2 = сьогодні + вчора, тощо)
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetDateStr = body.date; // YYYY-MM-DD
    const days = body.days ? parseInt(String(body.days), 10) : 1; // За замовчуванням 1 день (сьогодні)

    let targetDate: Date;
    if (targetDateStr) {
      // Якщо вказана конкретна дата
      targetDate = new Date(targetDateStr + 'T00:00:00.000Z');
    } else {
      // За замовчуванням - сьогодні
      targetDate = new Date();
      targetDate.setHours(0, 0, 0, 0);
    }

    const endDate = new Date(targetDate);
    endDate.setDate(endDate.getDate() + days - 1); // Якщо days=1, то endDate = targetDate
    endDate.setHours(23, 59, 59, 999);

    console.log(`[direct/sync-today-webhooks] Processing webhooks from ${targetDate.toISOString()} to ${endDate.toISOString()} (${days} day(s))`);

    // Отримуємо всі вебхуки з логу (останні 50, але також перевіряємо records:log)
    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 999);
    let events = rawItems
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
          return null;
        }
      })
      .filter(Boolean);

    // Також отримуємо record events з records:log (там більше даних)
    try {
      const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
      const recordEvents = recordsLogRaw
        .map((raw) => {
          try {
            const parsed = JSON.parse(raw);
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
            return null;
          }
        })
        .filter((r) => r && r.receivedAt);

      // Конвертуємо record events у формат вебхуків
      const convertedRecordEvents = recordEvents.map((record: any) => ({
        receivedAt: record.receivedAt,
        event: 'record',
        body: {
          resource: 'record',
          status: record.status || 'create',
          resource_id: record.recordId || record.visitId,
          data: {
            datetime: record.datetime,
            services: record.data?.services || (record.serviceName ? [{ title: record.serviceName, name: record.serviceName, id: record.serviceId }] : []),
            staff: record.data?.staff || (record.staffId ? { id: record.staffId } : null),
            client: record.data?.client || (record.clientId ? { id: record.clientId } : null),
            attendance: record.attendance,
            visit_id: record.visitId,
          },
        },
      }));

      events = [...events, ...convertedRecordEvents];
    } catch (err) {
      console.warn('[sync-today-webhooks] Failed to read records log:', err);
    }

    // Фільтруємо вебхуки за вказаний період та ті, що стосуються клієнтів або записів
    const filteredEvents = events.filter((e: any) => {
      // Перевіряємо, чи це client або record event
      const isClientEvent = e.body?.resource === 'client' && (e.body?.status === 'create' || e.body?.status === 'update');
      const isRecordEvent = e.body?.resource === 'record' && (e.body?.status === 'create' || e.body?.status === 'update');
      
      if (!isClientEvent && !isRecordEvent) return false;
      
      // Для record events перевіряємо також datetime з даних (може бути більш точною)
      let checkDate: Date | null = null;
      
      if (e.receivedAt) {
        checkDate = new Date(e.receivedAt);
      } else if (e.body?.data?.datetime) {
        // Якщо немає receivedAt, використовуємо datetime з даних запису
        checkDate = new Date(e.body.data.datetime);
      }
      
      if (!checkDate) return false;
      
      // Перевіряємо, чи дата в межах діапазону
      const isInRange = checkDate >= targetDate && checkDate <= endDate;
      
      return isInRange;
    });

    console.log(`[direct/sync-today-webhooks] Found ${filteredEvents.length} events in range (client + record) out of ${events.length} total events`);

    // Сортуємо за датою отримання (найстаріші першими)
    const todayEvents = filteredEvents.sort((a: any, b: any) => {
      const dateA = new Date(a.receivedAt || 0).getTime();
      const dateB = new Date(b.receivedAt || 0).getTime();
      return dateA - dateB;
    });

    console.log(`[direct/sync-today-webhooks] Processing ${todayEvents.length} events sorted by date`);

    // Імпортуємо функції для обробки вебхуків
    const { getAllDirectClients, getAllDirectStatuses, saveDirectClient } = await import('@/lib/direct-store');
    const { normalizeInstagram } = await import('@/lib/normalize');

    // Отримуємо існуючих клієнтів
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

    // Отримуємо статус за замовчуванням
    const allStatuses = await getAllDirectStatuses();
    const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
    if (!defaultStatus) {
      return NextResponse.json({
        ok: false,
        error: 'No default status found',
      }, { status: 500 });
    }

    const results = {
      totalEvents: todayEvents.length,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      clients: [] as any[],
    };

    // Обробляємо кожен вебхук
    for (const event of todayEvents) {
      try {
        // Для record events клієнт знаходиться в data.client
        // Для client events клієнт знаходиться в data або data.client
        const isRecordEvent = event.body?.resource === 'record';
        const clientId = isRecordEvent 
          ? (event.body?.data?.client?.id || event.body?.data?.client_id)
          : event.body?.resource_id;
        const client = isRecordEvent
          ? event.body?.data?.client
          : (event.body?.data?.client || event.body?.data);
        const status = event.body?.status;

        if (!clientId || !client) {
          results.skipped++;
          continue;
        }

        // Витягуємо Instagram username (використовуємо ту саму логіку, що й в webhook route)
        let instagram: string | null = null;
        
        if (client.custom_fields) {
          if (Array.isArray(client.custom_fields)) {
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
          } else if (typeof client.custom_fields === 'object') {
            for (const [key, value] of Object.entries(client.custom_fields)) {
              if (value && typeof value === 'string' && /instagram/i.test(key)) {
                instagram = value.trim();
                break;
              }
            }
          }
        }

        // Перевіряємо, чи Instagram валідний (не "no", не порожній, не null)
        const invalidValues = ['no', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];
        if (instagram) {
          const lowerInstagram = instagram.toLowerCase().trim();
          if (invalidValues.includes(lowerInstagram)) {
            instagram = null; // Вважаємо Instagram відсутнім
          }
        }

        // Якщо немає Instagram, перевіряємо збережений зв'язок
        let normalizedInstagram: string | null = null;
        let isMissingInstagram = false;

        const { getDirectClientByAltegioId } = await import('@/lib/direct-store');
        const existingClientByAltegioId = await getDirectClientByAltegioId(parseInt(String(clientId), 10));
        
        if (existingClientByAltegioId) {
          // Якщо клієнт існує, але в webhook є новий Instagram - використовуємо його (пріоритет webhook'у)
          if (instagram) {
            const normalizedFromWebhook = normalizeInstagram(instagram);
            if (normalizedFromWebhook) {
              normalizedInstagram = normalizedFromWebhook;
              isMissingInstagram = false;
              console.log(`[sync-today-webhooks] ✅ Found Instagram in webhook for existing client ${clientId}: ${normalizedInstagram} (updating from ${existingClientByAltegioId.instagramUsername})`);
            } else {
              // Якщо Instagram з webhook'а невалідний, використовуємо старий
              normalizedInstagram = existingClientByAltegioId.instagramUsername;
              isMissingInstagram = normalizedInstagram.startsWith('missing_instagram_');
            }
          } else {
            // Якщо в webhook немає Instagram, використовуємо існуючий
            normalizedInstagram = existingClientByAltegioId.instagramUsername;
            isMissingInstagram = normalizedInstagram.startsWith('missing_instagram_');
          }
        } else {
          // Клієнта не знайдено - обробляємо Instagram з вебхука
          if (!instagram) {
            isMissingInstagram = true;
            normalizedInstagram = `missing_instagram_${clientId}`;
          } else {
            normalizedInstagram = normalizeInstagram(instagram);
            if (!normalizedInstagram) {
              isMissingInstagram = true;
              normalizedInstagram = `missing_instagram_${clientId}`;
            } else {
              isMissingInstagram = false;
            }
          }
        }

        // Витягуємо ім'я
        const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

        // Шукаємо існуючого клієнта
        let existingClientIdByInstagram = normalizedInstagram && !normalizedInstagram.startsWith('missing_instagram_')
          ? existingInstagramMap.get(normalizedInstagram)
          : null;
        let existingClientIdByAltegio = clientId
          ? existingAltegioIdMap.get(parseInt(String(clientId), 10))
          : null;
        
        // Визначаємо, який клієнт залишити при об'єднанні
        // Пріоритет: клієнт з правильним Instagram, а не з missing_instagram_*
        let existingClientId: string | null = null;
        let duplicateClientId: string | null = null;
        
        if (existingClientIdByInstagram && existingClientIdByAltegio) {
          if (existingClientIdByInstagram === existingClientIdByAltegio) {
            // Це той самий клієнт - просто оновлюємо
            existingClientId = existingClientIdByInstagram;
          } else {
            // Різні клієнти - потрібно об'єднати
            const clientByInstagram = existingDirectClients.find((c) => c.id === existingClientIdByInstagram);
            const clientByAltegio = existingDirectClients.find((c) => c.id === existingClientIdByAltegio);
            
            // Перевіряємо, який має missing_instagram_*
            const instagramHasMissing = clientByInstagram?.instagramUsername?.startsWith('missing_instagram_');
            const altegioHasMissing = clientByAltegio?.instagramUsername?.startsWith('missing_instagram_');
            
            if (instagramHasMissing && !altegioHasMissing) {
              // Клієнт по Instagram має missing_instagram_*, клієнт по Altegio ID має правильний Instagram
              // Залишаємо клієнта по Altegio ID (з правильним Instagram)
              existingClientId = existingClientIdByAltegio;
              duplicateClientId = existingClientIdByInstagram;
              console.log(`[sync-today-webhooks] ⚠️ Found duplicate: keeping client ${existingClientId} (has real Instagram), deleting ${duplicateClientId} (has missing_instagram_*)`);
            } else if (!instagramHasMissing && altegioHasMissing) {
              // Клієнт по Altegio ID має missing_instagram_*, клієнт по Instagram має правильний Instagram
              // Залишаємо клієнта по Instagram (з правильним Instagram)
              existingClientId = existingClientIdByInstagram;
              duplicateClientId = existingClientIdByAltegio;
              console.log(`[sync-today-webhooks] ⚠️ Found duplicate: keeping client ${existingClientId} (has real Instagram), deleting ${duplicateClientId} (has missing_instagram_*)`);
            } else {
              // Обидва мають або не мають missing_instagram_* - залишаємо клієнта по Instagram (новіший)
              existingClientId = existingClientIdByInstagram;
              duplicateClientId = existingClientIdByAltegio;
              console.log(`[sync-today-webhooks] ⚠️ Found duplicate: keeping client ${existingClientId} (by Instagram), deleting ${duplicateClientId} (by Altegio ID)`);
            }
          }
        } else if (existingClientIdByInstagram) {
          existingClientId = existingClientIdByInstagram;
        } else if (existingClientIdByAltegio) {
          existingClientId = existingClientIdByAltegio;
        }

        if (existingClientId) {
          // Оновлюємо існуючого клієнта
          const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
          if (existingClient) {
            // Клієнти з Altegio завжди мають стан "client" (не можуть бути "lead")
            const clientState = 'client' as const;
            const updated = {
              ...existingClient,
              altegioClientId: parseInt(String(clientId), 10),
              instagramUsername: normalizedInstagram,
              state: clientState,
              ...(firstName && { firstName }),
              ...(lastName && { lastName }),
              updatedAt: new Date().toISOString(),
            };
            await saveDirectClient(updated);
            results.updated++;
            results.clients.push({
              id: updated.id,
              instagramUsername: normalizedInstagram,
              firstName,
              lastName,
              altegioClientId: clientId,
              action: 'updated',
              state: clientState,
            });
            
            // ОБРОБКА КОНСУЛЬТАЦІЙ для record events (якщо це record event)
            if (isRecordEvent && event.body?.data?.services && Array.isArray(event.body.data.services)) {
              try {
                const data = event.body.data;
                const services = data.services;
                const staffName = data.staff?.name || data.staff?.display_name || null;
                const attendance = data.attendance;
                const datetime = data.datetime;
                
                // Перевіряємо, чи є послуга "Консультація"
                const hasConsultation = services.some((s: any) => {
                  const title = s.title || s.name || '';
                  return /консультація/i.test(title);
                });
                
                if (hasConsultation && datetime) {
                  // Імпортуємо функції для обробки консультацій
                  const { getMasterByName } = await import('@/lib/direct-masters/store');
                  
                  // Перевіряємо, чи staffName є адміністратором
                  const getAllDirectMasters = (await import('@/lib/direct-masters/store')).getAllDirectMasters;
                  const masters = await getAllDirectMasters();
                  const wasAdminStaff = staffName ? !!masters.find(m => 
                    m.name === staffName && (m.role === 'admin' || m.role === 'direct-manager')
                  ) : false;
                  
                  // Перевіряємо, чи в історії станів клієнта вже є консультації
                  const { getStateHistory } = await import('@/lib/direct-state-log');
                  const history = await getStateHistory(updated.id);
                  const consultationStates = ['consultation', 'consultation-booked', 'consultation-no-show', 'consultation-rescheduled'];
                  const hadConsultationBefore = history.some(log => consultationStates.includes(log.state || ''));
                  
                  // Обробка запису на консультацію (ПЕРША консультація)
                  if (status === 'create' && wasAdminStaff && !hadConsultationBefore) {
                    const consultationUpdates = {
                      state: 'consultation-booked' as const,
                      consultationBookingDate: datetime,
                      updatedAt: new Date().toISOString(),
                    };
                    
                    const consultationUpdated = {
                      ...updated,
                      ...consultationUpdates,
                    };
                    
                    await saveDirectClient(consultationUpdated, 'sync-today-webhooks-consultation-booked', {
                      altegioClientId: clientId,
                      staffName,
                      datetime,
                    });
                    
                    console.log(`[sync-today-webhooks] ✅ Set consultation-booked state for client ${updated.id}`);
                  }
                  // Обробка приходу клієнта на консультацію
                  // Якщо клієнт прийшов на консультацію (attendance === 1), встановлюємо стан 'consultation'
                  // Це може бути як перша консультація, так і оновлення з consultation-booked на consultation
                  else if (attendance === 1 && !wasAdminStaff && staffName) {
                    // Перевіряємо, чи в історії вже є стан 'consultation' (фактична консультація)
                    const { getStateHistory } = await import('@/lib/direct-state-log');
                    const history = await getStateHistory(updated.id);
                    const hasActualConsultation = history.some(log => log.state === 'consultation');
                    
                    // Якщо ще немає фактичної консультації в історії, встановлюємо
                    if (!hasActualConsultation) {
                      const master = await getMasterByName(staffName);
                      if (master) {
                        const consultationUpdates = {
                          state: 'consultation' as const,
                          consultationAttended: true,
                          consultationMasterId: master.id,
                          consultationMasterName: master.name,
                          consultationDate: datetime,
                          consultationBookingDate: updated.consultationBookingDate || datetime,
                          masterId: master.id,
                          masterManuallySet: false,
                          updatedAt: new Date().toISOString(),
                        };
                        
                        const consultationUpdated = {
                          ...updated,
                          ...consultationUpdates,
                        };
                        
                        await saveDirectClient(consultationUpdated, 'sync-today-webhooks-consultation-attended', {
                          altegioClientId: clientId,
                          staffName,
                          masterId: master.id,
                          masterName: master.name,
                          datetime,
                        });
                        
                        console.log(`[sync-today-webhooks] ✅ Set consultation state (attended) for client ${updated.id}, master: ${master.name}`);
                      }
                    } else {
                      console.log(`[sync-today-webhooks] ⏭️ Client ${updated.id} already has consultation state in history, skipping`);
                    }
                  }
                }
              } catch (consultationErr) {
                console.error(`[sync-today-webhooks] ⚠️ Failed to process consultation logic:`, consultationErr);
                // Не зупиняємо обробку через помилку
              }
            }
            
            // Якщо знайдено дублікат, перевіряємо, чи можна його видалити
            if (duplicateClientId) {
              try {
                const duplicateClient = existingDirectClients.find((c) => c.id === duplicateClientId);
                if (duplicateClient) {
                  // Перевіряємо, чи є у дубліката записи (state logs, дати візитів тощо)
                  const { getStateHistory } = await import('@/lib/direct-state-log');
                  const duplicateHistory = await getStateHistory(duplicateClientId);
                  const hasRecords = 
                    duplicateHistory.length > 1 || // Є записи в історії (більше ніж поточний стан)
                    duplicateClient.paidServiceDate ||
                    duplicateClient.consultationBookingDate ||
                    duplicateClient.consultationDate ||
                    duplicateClient.visitDate ||
                    duplicateClient.lastMessageAt;
                  
                  if (hasRecords) {
                    // У дубліката є записи - не видаляємо, а оновлюємо його замість основного клієнта
                    console.log(`[sync-today-webhooks] ⚠️ Duplicate client ${duplicateClientId} has records, keeping it instead of ${existingClientId}`);
                    
                    // Видаляємо "основного" клієнта і залишаємо дубліката
                    const { deleteDirectClient } = await import('@/lib/direct-store');
                    await deleteDirectClient(existingClientId);
                    console.log(`[sync-today-webhooks] ✅ Deleted client ${existingClientId} (no records), kept ${duplicateClientId} (has records)`);
                    
                    // Оновлюємо дубліката з новими даними
                    const clientState = 'client' as const;
                    const updatedDuplicate = {
                      ...duplicateClient,
                      altegioClientId: parseInt(String(clientId), 10),
                      instagramUsername: normalizedInstagram,
                      state: clientState,
                      ...(firstName && { firstName }),
                      ...(lastName && { lastName }),
                      updatedAt: new Date().toISOString(),
                    };
                    const { saveDirectClient } = await import('@/lib/direct-store');
                    await saveDirectClient(updatedDuplicate);
                    
                    // Оновлюємо results - замінюємо updated на правильний ID
                    results.clients = results.clients.filter((c: any) => c.id !== existingClientId);
                    results.clients.push({
                      id: updatedDuplicate.id,
                      instagramUsername: normalizedInstagram,
                      firstName,
                      lastName,
                      altegioClientId: clientId,
                      action: 'updated',
                      state: clientState,
                    });
                    results.clients.push({
                      id: existingClientId,
                      instagramUsername: 'DELETED_NO_RECORDS',
                      action: 'deleted',
                      state: 'deleted',
                    });
                  } else {
                    // У дубліката немає записів - можна видалити
                    const { deleteDirectClient } = await import('@/lib/direct-store');
                    await deleteDirectClient(duplicateClientId);
                    console.log(`[sync-today-webhooks] ✅ Deleted duplicate client ${duplicateClientId} (no records)`);
                    results.clients.push({
                      id: duplicateClientId,
                      instagramUsername: 'DELETED_DUPLICATE',
                      action: 'deleted',
                      state: 'deleted',
                    });
                  }
                }
              } catch (deleteErr) {
                console.error(`[sync-today-webhooks] ❌ Failed to process duplicate client ${duplicateClientId}:`, deleteErr);
                results.errors.push(`Failed to process duplicate client ${duplicateClientId}: ${deleteErr instanceof Error ? deleteErr.message : String(deleteErr)}`);
              }
            }
          }
        } else {
          // Створюємо нового клієнта
          const now = new Date().toISOString();
          // Клієнти з Altegio завжди мають стан "client" (не можуть бути "lead")
          const clientState = 'client' as const;
          const newClient = {
            id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            source: 'instagram' as const,
            state: clientState,
            firstContactDate: now,
            statusId: defaultStatus.id,
            visitedSalon: false,
            signedUpForPaidService: false,
            altegioClientId: parseInt(String(clientId), 10),
            createdAt: now,
            updatedAt: now,
          };
          await saveDirectClient(newClient);
          results.created++;
          results.clients.push({
            id: newClient.id,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            altegioClientId: clientId,
            action: 'created',
            state: clientState,
          });
        }

        results.processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(errorMsg);
        console.error(`[direct/sync-today-webhooks] Error processing event:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      date: targetDate.toISOString().split('T')[0],
      dateRange: {
        from: targetDate.toISOString(),
        to: endDate.toISOString(),
        days,
      },
      totalEvents: events.length,
      filteredEvents: filteredEvents.length,
      processed: results.processed,
      created: results.created,
      updated: results.updated,
      skipped: results.skipped,
      errors: results.errors,
      clients: results.clients,
    });
  } catch (error) {
    console.error('[direct/sync-today-webhooks] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET - отримати інформацію про сьогоднішні вебхуки (без обробки)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const events = rawItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
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
          return null;
        }
      })
      .filter(Boolean);

    const todayClientEvents = events
      .filter((e: any) => {
        if (!e.receivedAt) return false;
        const receivedDate = new Date(e.receivedAt);
        receivedDate.setHours(0, 0, 0, 0);
        return receivedDate.getTime() === today.getTime();
      })
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        event: e.event || e.body?.event,
        resource: e.body?.resource,
        status: e.body?.status,
        resourceId: e.body?.resource_id,
        clientName: e.body?.data?.client?.name || e.body?.data?.client?.display_name || e.body?.data?.name,
        clientId: e.body?.data?.client?.id || e.body?.data?.id,
      }));

    return NextResponse.json({
      ok: true,
      date: today.toISOString(),
      totalEvents: todayClientEvents.length,
      events: todayClientEvents,
    });
  } catch (error) {
    console.error('[direct/sync-today-webhooks] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

