// web/app/api/admin/direct/sync-today-webhooks/route.ts
// Обробка сьогоднішніх вебхуків від Altegio для синхронізації клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

export const maxDuration = 300;

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
      const convertedRecordEvents = recordEvents.map((record: any) => {
        // Використовуємо datetime як receivedAt, якщо receivedAt відсутній
        const receivedAt = record.receivedAt || record.datetime || new Date().toISOString();
        
        // Формуємо services масив
        let services: any[] = [];
        if (record.data?.services && Array.isArray(record.data.services)) {
          services = record.data.services;
        } else if (record.serviceName) {
          services = [{ title: record.serviceName, name: record.serviceName, id: record.serviceId }];
        }
        
        // Формуємо staff об'єкт
        let staff: any = null;
        if (record.data?.staff) {
          staff = record.data.staff;
        } else if (record.staffId || record.staffName) {
          staff = {
            id: record.staffId,
            name: record.staffName,
            display_name: record.staffName,
          };
        }
        
        return {
          receivedAt,
          event: 'record',
          isFromRecordsLog: true, // Позначаємо, що це з records log
          originalRecord: record, // Зберігаємо оригінальний запис для діагностики
          body: {
            resource: 'record',
            status: record.status || 'create',
            resource_id: record.recordId || record.visitId,
            data: {
              datetime: record.datetime,
              services: services,
              staff: staff,
              client: record.data?.client || (record.clientId ? { id: record.clientId } : null),
              attendance: record.data?.attendance ?? record.attendance,
              visit_id: record.visitId,
            },
          },
        };
      });

      events = [...events, ...convertedRecordEvents];
    } catch (err) {
      console.warn('[sync-today-webhooks] Failed to read records log:', err);
    }

    // Фільтруємо вебхуки за вказаний період та ті, що стосуються клієнтів або записів
    let sampleCount = 0;
    const TARGET_CLIENT_ID = 172203711; // Аліна - для діагностики
    const filteredEvents = events.filter((e: any) => {
      // Перевіряємо, чи це client або record event
      const isClientEvent = e.body?.resource === 'client' && (e.body?.status === 'create' || e.body?.status === 'update');
      const isRecordEvent = e.body?.resource === 'record' && (e.body?.status === 'create' || e.body?.status === 'update');
      
      // Витягуємо clientId для перевірки
      const eventClientId = e.body?.data?.client?.id || 
                           e.body?.data?.client_id || 
                           (e.isFromRecordsLog && e.originalRecord?.clientId) ||
                           null;
      
      // Діагностика для цільового клієнта (Аліна)
      if (eventClientId === TARGET_CLIENT_ID) {
        console.log(`[sync-today-webhooks] 🔍 Found event for target client ${TARGET_CLIENT_ID}:`, {
          resource: e.body?.resource,
          status: e.body?.status,
          isClientEvent,
          isRecordEvent,
          receivedAt: e.receivedAt,
          datetime: e.body?.data?.datetime,
          isFromRecordsLog: e.isFromRecordsLog,
          hasServices: !!e.body?.data?.services,
          services: e.body?.data?.services || (e.isFromRecordsLog ? e.originalRecord?.data?.services : null),
          serviceName: e.isFromRecordsLog ? e.originalRecord?.serviceName : null,
        });
      }
      
      if (!isClientEvent && !isRecordEvent) {
        // Логуємо перші кілька прикладів для діагностики
        if (sampleCount < 3) {
          console.log(`[sync-today-webhooks] Sample skipped event (not client/record):`, {
            resource: e.body?.resource,
            status: e.body?.status,
            hasBody: !!e.body,
          });
          sampleCount++;
        }
        if (eventClientId === TARGET_CLIENT_ID) {
          console.log(`[sync-today-webhooks] ❌ Target client ${TARGET_CLIENT_ID} event skipped: not client/record event`);
        }
        return false;
      }
      
      // Для record events використовуємо datetime з даних (це дата запису, більш точно)
      // Для client events використовуємо receivedAt
      let checkDate: Date | null = null;
      
      if (e.body?.resource === 'record' && e.body?.data?.datetime) {
        // Для record events використовуємо datetime з даних (це дата запису, а не отримання вебхука)
        checkDate = new Date(e.body.data.datetime);
      } else if (e.receivedAt) {
        // Для client events або якщо немає datetime - використовуємо receivedAt
        checkDate = new Date(e.receivedAt);
      }
      
      if (!checkDate || isNaN(checkDate.getTime())) {
        if (sampleCount < 3) {
          console.log(`[sync-today-webhooks] Sample skipped event (no valid date):`, {
            hasReceivedAt: !!e.receivedAt,
            receivedAt: e.receivedAt,
            hasDatetime: !!e.body?.data?.datetime,
            datetime: e.body?.data?.datetime,
            resource: e.body?.resource,
            isFromRecordsLog: e.isFromRecordsLog,
          });
          sampleCount++;
        }
        if (eventClientId === TARGET_CLIENT_ID) {
          console.log(`[sync-today-webhooks] ❌ Target client ${TARGET_CLIENT_ID} event skipped: no valid date`, {
            receivedAt: e.receivedAt,
            datetime: e.body?.data?.datetime,
            isFromRecordsLog: e.isFromRecordsLog,
            originalRecordDatetime: e.isFromRecordsLog ? e.originalRecord?.datetime : null,
          });
        }
        return false;
      }
      
      // Перевіряємо, чи дата в межах діапазону
      // ВАЖЛИВО: Для record events з майбутніми датами (наприклад, запис на 19 січня)
      // ми також обробляємо їх, якщо receivedAt (дата отримання вебхука) в діапазоні
      // Це дозволяє обробляти записи на майбутнє, які були створені сьогодні
      // Приклад: запис створений 5 січня на 19 січня - обробиться, якщо синхронізація для 5-6 січня
      let isInRange = checkDate >= targetDate && checkDate <= endDate;
      let futureRecordIncluded = false;
      
      // Якщо це record event і дата запису поза діапазоном, але receivedAt в діапазоні - обробляємо
      if (!isInRange && isRecordEvent && e.receivedAt) {
        const receivedDate = new Date(e.receivedAt);
        if (!isNaN(receivedDate.getTime()) && receivedDate >= targetDate && receivedDate <= endDate) {
          isInRange = true;
          futureRecordIncluded = true;
          console.log(`[sync-today-webhooks] 📅 Record event with future datetime will be processed (receivedAt in range):`, {
            checkDate: checkDate.toISOString(),
            receivedAt: receivedDate.toISOString(),
            targetDate: targetDate.toISOString(),
            endDate: endDate.toISOString(),
            clientId: eventClientId,
            reason: `Appointment date (${checkDate.toISOString().split('T')[0]}) is in future, but webhook was received (${receivedDate.toISOString().split('T')[0]}) within sync range`,
          });
        }
      }
      
      if (!isInRange && sampleCount < 3) {
        console.log(`[sync-today-webhooks] Sample skipped event (date out of range):`, {
          checkDate: checkDate.toISOString(),
          targetDate: targetDate.toISOString(),
          endDate: endDate.toISOString(),
          resource: e.body?.resource,
          receivedAt: e.receivedAt,
          datetime: e.body?.data?.datetime,
        });
        sampleCount++;
      }
      
      if (eventClientId === TARGET_CLIENT_ID && !isInRange) {
        console.log(`[sync-today-webhooks] ❌ Target client ${TARGET_CLIENT_ID} event skipped: date out of range`, {
          checkDate: checkDate.toISOString(),
          receivedAt: e.receivedAt ? new Date(e.receivedAt).toISOString() : null,
          targetDate: targetDate.toISOString(),
          endDate: endDate.toISOString(),
          resource: e.body?.resource,
          datetime: e.body?.data?.datetime,
        });
      }
      
      if (eventClientId === TARGET_CLIENT_ID && isInRange) {
        console.log(`[sync-today-webhooks] ✅ Target client ${TARGET_CLIENT_ID} event WILL BE PROCESSED`);
      }
      
      // Додаємо clientId до об'єкта event для подальшого використання
      if (isInRange && eventClientId) {
        (e as any).clientId = eventClientId;
      }
      
      return isInRange;
    });

    console.log(`[direct/sync-today-webhooks] Found ${filteredEvents.length} events in range (client + record) out of ${events.length} total events`);
    
    // Логуємо приклади відфільтрованих подій
    if (filteredEvents.length > 0) {
      console.log(`[direct/sync-today-webhooks] Sample filtered events:`, filteredEvents.slice(0, 3).map((e: any) => ({
        resource: e.body?.resource,
        status: e.body?.status,
        receivedAt: e.receivedAt,
        datetime: e.body?.data?.datetime,
        clientId: e.body?.data?.client?.id || e.body?.data?.client_id,
      })));
    }

    // Сортуємо за датою отримання (найстаріші першими)
    const todayEvents = filteredEvents.sort((a: any, b: any) => {
      const dateA = new Date(a.receivedAt || 0).getTime();
      const dateB = new Date(b.receivedAt || 0).getTime();
      return dateA - dateB;
    });

    // Діагностика для цільового клієнта
    const targetEventsInToday = todayEvents.filter((e: any) => {
      // Перевіряємо всі можливі джерела clientId
      const eventClientId = (e as any).clientId || // Додається під час фільтрації
                           e.body?.data?.client?.id || 
                           e.body?.data?.client_id || 
                           (e.isFromRecordsLog && e.originalRecord?.clientId) ||
                           null;
      return eventClientId === TARGET_CLIENT_ID;
    });
    
    if (targetEventsInToday.length > 0) {
      console.log(`[sync-today-webhooks] 🔍 Found ${targetEventsInToday.length} target client ${TARGET_CLIENT_ID} events in todayEvents:`, 
        targetEventsInToday.map((e: any) => ({
          receivedAt: e.receivedAt,
          resource: e.body?.resource,
          status: e.body?.status,
          clientIdFromProperty: (e as any).clientId, // Перевіряємо, чи зберігся clientId
          clientIdFromBody: e.body?.data?.client?.id,
          clientIdFromOriginalRecord: e.isFromRecordsLog ? e.originalRecord?.clientId : null,
          isFromRecordsLog: e.isFromRecordsLog,
        }))
      );
    } else {
      console.log(`[sync-today-webhooks] ❌ Target client ${TARGET_CLIENT_ID} events NOT found in todayEvents after sorting!`);
      console.log(`[sync-today-webhooks] 🔍 Filtered events count: ${filteredEvents.length}, Today events count: ${todayEvents.length}`);
      
      // Додаткова діагностика: перевіряємо, чи clientId зберігся в filteredEvents
      const targetInFiltered = filteredEvents.filter((e: any) => {
        const eventClientId = (e as any).clientId || 
                             e.body?.data?.client?.id || 
                             e.body?.data?.client_id || 
                             (e.isFromRecordsLog && e.originalRecord?.clientId) ||
                             null;
        return eventClientId === TARGET_CLIENT_ID;
      });
      
      if (targetInFiltered.length > 0) {
        console.log(`[sync-today-webhooks] ⚠️ Target client ${TARGET_CLIENT_ID} events found in filteredEvents but NOT in todayEvents after sorting!`);
        console.log(`[sync-today-webhooks] 🔍 Target events in filteredEvents:`, 
          targetInFiltered.map((e: any) => ({
            receivedAt: e.receivedAt,
            clientIdFromProperty: (e as any).clientId,
            clientIdFromBody: e.body?.data?.client?.id,
          }))
        );
      }
    }

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
    const TARGET_CLIENT_ID_LOOP = 172203711; // Аліна - для діагностики в циклі
    
    // Діагностика: перевіряємо перші кілька подій перед циклом
    console.log(`[sync-today-webhooks] 🔍 Checking first 5 events before loop for target client ${TARGET_CLIENT_ID_LOOP}:`);
    for (let i = 0; i < Math.min(5, todayEvents.length); i++) {
      const e = todayEvents[i] as any;
      const eventClientId = e.clientId || 
                           e.body?.data?.client?.id || 
                           e.body?.data?.client_id || 
                           (e.isFromRecordsLog && e.originalRecord?.clientId) ||
                           null;
      console.log(`[sync-today-webhooks]   Event ${i + 1}:`, {
        resource: e.body?.resource,
        receivedAt: e.receivedAt,
        clientIdFromProperty: e.clientId,
        clientIdFromBody: e.body?.data?.client?.id,
        clientIdFromOriginalRecord: e.isFromRecordsLog ? e.originalRecord?.clientId : null,
        finalClientId: eventClientId,
        isTarget: eventClientId === TARGET_CLIENT_ID_LOOP,
      });
    }
    
    let loopIndex = 0;
    for (const event of todayEvents) {
      loopIndex++;
      try {
        // Для record events клієнт знаходиться в data.client
        // Для client events клієнт знаходиться в data або data.client
        const isRecordEvent = event.body?.resource === 'record';
        
        // Діагностика: перевіряємо всі можливі місця для clientId для цільового клієнта
        // Перевіряємо спочатку event.clientId (додається під час фільтрації)
        const eventClientId = (event as any).clientId;
        const possibleClientId1 = isRecordEvent 
          ? event.body?.data?.client?.id 
          : event.body?.resource_id;
        const possibleClientId2 = isRecordEvent 
          ? event.body?.data?.client_id 
          : null;
        const possibleClientId3 = event.isFromRecordsLog && event.originalRecord 
          ? (event.originalRecord.clientId || 
             event.originalRecord.data?.client?.id ||
             event.originalRecord.data?.client_id ||
             null)
          : null;
        
        // Додаткове логування на самому початку для цільового клієнта
        const mightBeTargetAtStart = eventClientId === TARGET_CLIENT_ID_LOOP ||
                                      possibleClientId1 === TARGET_CLIENT_ID_LOOP || 
                                      possibleClientId2 === TARGET_CLIENT_ID_LOOP || 
                                      possibleClientId3 === TARGET_CLIENT_ID_LOOP;
        
        if (mightBeTargetAtStart) {
          console.log(`[sync-today-webhooks] 🎯 STARTING LOOP [${loopIndex}/${todayEvents.length}] for target client ${TARGET_CLIENT_ID_LOOP}:`, {
            eventClientId,
            possibleClientId1,
            possibleClientId2,
            possibleClientId3,
            hasBody: !!event.body,
            resource: event.body?.resource,
            receivedAt: event.receivedAt,
            isFromRecordsLog: event.isFromRecordsLog,
            hasOriginalRecord: !!event.originalRecord,
          });
        }
        
        // Перевіряємо, чи це може бути вебхук для цільового клієнта
        // (використовуємо значення, які вже обчислені вище)
        const mightBeTargetClient = mightBeTargetAtStart;
        
        if (mightBeTargetClient) {
          console.log(`[sync-today-webhooks] 🔍 BEFORE extraction for target client ${TARGET_CLIENT_ID_LOOP}:`, {
            isRecordEvent,
            eventClientId,
            possibleClientId1,
            possibleClientId2,
            possibleClientId3,
            isFromRecordsLog: event.isFromRecordsLog,
            bodyDataClient: event.body?.data?.client,
            bodyDataClientId: event.body?.data?.client_id,
            resourceId: event.body?.resource_id,
            originalRecordClientId: event.originalRecord?.clientId,
            originalRecordDataClientId: event.originalRecord?.data?.client?.id,
          });
        }
        
        // Витягуємо clientId, враховуючи структуру для конвертованих вебхуків з records:log
        // Використовуємо event.clientId як першочергове джерело (додається під час фільтрації)
        let clientId = eventClientId || possibleClientId1 || possibleClientId2;
        
        // Якщо clientId не знайдено і це конвертований вебхук з records:log, шукаємо в originalRecord
        if (!clientId && event.isFromRecordsLog && event.originalRecord) {
          clientId = possibleClientId3;
          
          // Якщо знайшли clientId в originalRecord, додаємо його до body.data.client для подальшої обробки
          if (clientId && isRecordEvent && !event.body?.data?.client?.id) {
            if (!event.body.data) event.body.data = {};
            if (!event.body.data.client) event.body.data.client = {};
            event.body.data.client.id = clientId;
            
            if (mightBeTargetClient) {
              console.log(`[sync-today-webhooks] ✅ Extracted clientId ${clientId} from originalRecord and added to body.data.client`);
            }
          }
        }
        
        // Діагностика ПІСЛЯ витягування
        if (mightBeTargetClient) {
          console.log(`[sync-today-webhooks] 🔍 AFTER extraction for target client ${TARGET_CLIENT_ID_LOOP}:`, {
            finalClientId: clientId,
            wasExtracted: !!possibleClientId3 && clientId === possibleClientId3,
          });
        }
        
        const client = isRecordEvent
          ? event.body?.data?.client
          : (event.body?.data?.client || event.body?.data);
        const status = event.body?.status;

        // Діагностика для цільового клієнта
        if (clientId === TARGET_CLIENT_ID_LOOP) {
          console.log(`[sync-today-webhooks] 🔍 Processing webhook for target client ${TARGET_CLIENT_ID_LOOP}:`, {
            isRecordEvent,
            clientId,
            hasClient: !!client,
            status,
            isFromRecordsLog: event.isFromRecordsLog,
            originalRecordClientId: event.isFromRecordsLog ? event.originalRecord?.clientId : undefined,
            clientKeys: client ? Object.keys(client) : [],
            hasServices: isRecordEvent ? !!event.body?.data?.services : false,
            services: isRecordEvent ? event.body?.data?.services : null,
            datetime: isRecordEvent ? event.body?.data?.datetime : null,
          });
        }

        if (!clientId || !client) {
          if (clientId === TARGET_CLIENT_ID_LOOP || eventClientId === TARGET_CLIENT_ID_LOOP || possibleClientId1 === TARGET_CLIENT_ID_LOOP || possibleClientId2 === TARGET_CLIENT_ID_LOOP || possibleClientId3 === TARGET_CLIENT_ID_LOOP) {
            console.log(`[sync-today-webhooks] ❌ Target client ${TARGET_CLIENT_ID_LOOP} event skipped: no clientId or client object`, {
              clientId,
              hasClient: !!client,
              isFromRecordsLog: event.isFromRecordsLog,
              originalRecordClientId: event.isFromRecordsLog ? event.originalRecord?.clientId : undefined,
              bodyDataClient: event.body?.data?.client,
            });
          }
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

        // Перевіряємо, чи Instagram валідний (не "no/ні", не порожній, не null)
        const invalidValues = ['no', 'ні', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];
        const isExplicitNoInstagram = !!instagram && ['no', 'ні'].includes(instagram.toLowerCase().trim());
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
              
              // ВАЖЛИВО: Якщо існуючий клієнт має missing_instagram_*, а вебхук містить правильний Instagram,
              // перевіряємо, чи є інший клієнт з цим правильним Instagram (можливо, створений з Manychat)
              if (existingClientByAltegioId.instagramUsername.startsWith('missing_instagram_')) {
                const clientWithRealInstagram = existingDirectClients.find((c) => 
                  c.instagramUsername === normalizedInstagram &&
                  c.id !== existingClientByAltegioId.id
                );
                
                if (clientWithRealInstagram) {
                  console.log(`[sync-today-webhooks] 🔄 Found client with real Instagram ${normalizedInstagram} (${clientWithRealInstagram.id}) while existing client ${existingClientByAltegioId.id} has missing_instagram_*. Will merge them.`);
                  // Це буде оброблено далі в логіці об'єднання
                }
              }
            } else {
              // Якщо Instagram з webhook'а невалідний, використовуємо старий
              normalizedInstagram = existingClientByAltegioId.instagramUsername;
              isMissingInstagram =
                normalizedInstagram.startsWith('missing_instagram_') || normalizedInstagram.startsWith('no_instagram_');
            }
          } else {
            // Якщо в webhook немає Instagram, використовуємо існуючий
            normalizedInstagram = existingClientByAltegioId.instagramUsername;
            isMissingInstagram =
              normalizedInstagram.startsWith('missing_instagram_') || normalizedInstagram.startsWith('no_instagram_');
          }
        } else {
          // Клієнта не знайдено - обробляємо Instagram з вебхука
          if (!instagram) {
            isMissingInstagram = true;
            normalizedInstagram = isExplicitNoInstagram ? `no_instagram_${clientId}` : `missing_instagram_${clientId}`;
          } else {
            normalizedInstagram = normalizeInstagram(instagram);
            if (!normalizedInstagram) {
              isMissingInstagram = true;
              normalizedInstagram = isExplicitNoInstagram ? `no_instagram_${clientId}` : `missing_instagram_${clientId}`;
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
        
        // Якщо клієнта не знайдено за altegioClientId або Instagram, шукаємо за іменем
        let existingClientIdByName: string | null = null;
        if (!existingClientIdByInstagram && !existingClientIdByAltegio && firstName && lastName) {
          existingClientIdByName = existingDirectClients.find((dc) => {
            const dcFirstName = (dc.firstName || '').trim().toLowerCase();
            const dcLastName = (dc.lastName || '').trim().toLowerCase();
            const searchFirstName = firstName.trim().toLowerCase();
            const searchLastName = lastName.trim().toLowerCase();
            
            return dcFirstName === searchFirstName && dcLastName === searchLastName;
          })?.id || null;
          
          if (existingClientIdByName) {
            console.log(`[sync-today-webhooks] 🔍 Found client by name "${firstName} ${lastName}": ${existingClientIdByName}`);
          }
        }
        
        // Визначаємо, який клієнт залишити при об'єднанні
        // Пріоритет: клієнт з правильним Instagram, а не з missing_instagram_*
        let existingClientId: string | null = null;
        let duplicateClientId: string | null = null;
        
        // ДОДАТКОВА ПЕРЕВІРКА: Якщо знайдено клієнта за Instagram, але також існує клієнт з missing_instagram_* та тим самим altegioClientId
        // (або навпаки), потрібно об'єднати їх
        if (existingClientIdByInstagram && clientId) {
          const clientByInstagram = existingDirectClients.find((c) => c.id === existingClientIdByInstagram);
          const hasRealInstagram = clientByInstagram && !clientByInstagram.instagramUsername.startsWith('missing_instagram_');
          
          if (hasRealInstagram) {
            // Перевіряємо, чи є інший клієнт з missing_instagram_* та тим самим altegioClientId
            const clientWithMissingInstagram = existingDirectClients.find((c) => 
              c.altegioClientId === parseInt(String(clientId), 10) &&
              c.id !== existingClientIdByInstagram &&
              c.instagramUsername.startsWith('missing_instagram_')
            );
            
            if (clientWithMissingInstagram) {
              console.log(`[sync-today-webhooks] 🔄 Found duplicate: client ${existingClientIdByInstagram} (has real Instagram ${clientByInstagram.instagramUsername}) and ${clientWithMissingInstagram.id} (has missing_instagram_*), merging...`);
              duplicateClientId = clientWithMissingInstagram.id;
            }
          }
        }
        
        // Аналогічно, якщо знайдено клієнта за altegioClientId з missing_instagram_*, але також існує клієнт з реальним Instagram
        if (existingClientIdByAltegio && normalizedInstagram && !normalizedInstagram.startsWith('missing_instagram_')) {
          const clientByAltegio = existingDirectClients.find((c) => c.id === existingClientIdByAltegio);
          const hasMissingInstagram = clientByAltegio && clientByAltegio.instagramUsername.startsWith('missing_instagram_');
          
          if (hasMissingInstagram) {
            // Перевіряємо, чи є інший клієнт з реальним Instagram username
            const clientWithRealInstagram = existingDirectClients.find((c) => 
              c.instagramUsername === normalizedInstagram &&
              c.id !== existingClientIdByAltegio
            );
            
            if (clientWithRealInstagram) {
              console.log(`[sync-today-webhooks] 🔄 Found duplicate: client ${clientWithRealInstagram.id} (has real Instagram ${normalizedInstagram}) and ${existingClientIdByAltegio} (has missing_instagram_*), merging...`);
              existingClientId = clientWithRealInstagram.id;
              duplicateClientId = existingClientIdByAltegio;
            }
          }
        }
        
        // ДОДАТКОВА ПЕРЕВІРКА: Якщо знайдено клієнта за іменем, але він має missing_instagram_*, 
        // а вебхук містить правильний Instagram, шукаємо клієнта з правильним Instagram за іменем
        if (existingClientIdByName && normalizedInstagram && !normalizedInstagram.startsWith('missing_instagram_')) {
          const clientByName = existingDirectClients.find((c) => c.id === existingClientIdByName);
          const hasMissingInstagram = clientByName && clientByName.instagramUsername.startsWith('missing_instagram_');
          
          if (hasMissingInstagram) {
            // Шукаємо клієнта з правильним Instagram та тим самим іменем
            const clientWithRealInstagram = existingDirectClients.find((c) => {
              const cFirstName = (c.firstName || '').trim().toLowerCase();
              const cLastName = (c.lastName || '').trim().toLowerCase();
              const searchFirstName = firstName.trim().toLowerCase();
              const searchLastName = lastName.trim().toLowerCase();
              
              return c.instagramUsername === normalizedInstagram &&
                     c.id !== existingClientIdByName &&
                     cFirstName === searchFirstName &&
                     cLastName === searchLastName;
            });
            
            if (clientWithRealInstagram) {
              console.log(`[sync-today-webhooks] 🔄 Found duplicate by name: client ${clientWithRealInstagram.id} (has real Instagram ${normalizedInstagram}, name: ${firstName} ${lastName}) and ${existingClientIdByName} (has missing_instagram_*), merging...`);
              existingClientId = clientWithRealInstagram.id;
              duplicateClientId = existingClientIdByName;
              existingClientIdByName = null; // Очищаємо, щоб не використовувати далі
            }
          }
        }
        
        // Якщо знайдено клієнта за іменем з правильним Instagram, але вебхук містить missing_instagram_*,
        // залишаємо клієнта з правильним Instagram
        if (existingClientIdByName && isMissingInstagram && normalizedInstagram.startsWith('missing_instagram_')) {
          const clientByName = existingDirectClients.find((c) => c.id === existingClientIdByName);
          const hasRealInstagram = clientByName && !clientByName.instagramUsername.startsWith('missing_instagram_');
          
          if (hasRealInstagram) {
            console.log(`[sync-today-webhooks] 🔄 Keeping client ${existingClientIdByName} (has real Instagram ${clientByName.instagramUsername}) instead of creating new with missing_instagram_*`);
            existingClientId = existingClientIdByName;
            isMissingInstagram = false;
            normalizedInstagram = clientByName.instagramUsername;
          }
        }
        
        if (existingClientIdByInstagram && existingClientIdByAltegio) {
          if (existingClientIdByInstagram === existingClientIdByAltegio) {
            // Це той самий клієнт - просто оновлюємо
            if (!existingClientId) {
              existingClientId = existingClientIdByInstagram;
            }
          } else if (!existingClientId) {
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
        } else if (existingClientIdByInstagram && !existingClientId) {
          existingClientId = existingClientIdByInstagram;
        } else if (existingClientIdByAltegio && !existingClientId) {
          // ВАЖЛИВО: Якщо клієнт знайдений за altegioClientId має missing_instagram_*, 
          // а вебхук містить правильний Instagram, перевіряємо, чи є інший клієнт з цим Instagram
          const clientByAltegio = existingDirectClients.find((c) => c.id === existingClientIdByAltegio);
          if (clientByAltegio && 
              clientByAltegio.instagramUsername.startsWith('missing_instagram_') &&
              normalizedInstagram && 
              !normalizedInstagram.startsWith('missing_instagram_')) {
            // Шукаємо клієнта з правильним Instagram
            const clientWithRealInstagram = existingDirectClients.find((c) => 
              c.instagramUsername === normalizedInstagram &&
              c.id !== existingClientIdByAltegio
            );
            
            if (clientWithRealInstagram) {
              console.log(`[sync-today-webhooks] 🔄 Found client with real Instagram ${normalizedInstagram} (${clientWithRealInstagram.id}) while client by Altegio ID ${existingClientIdByAltegio} has missing_instagram_*. Using client with real Instagram.`);
              existingClientId = clientWithRealInstagram.id;
              duplicateClientId = existingClientIdByAltegio;
            } else {
              // Клієнта з правильним Instagram не знайдено - оновлюємо існуючого
              existingClientId = existingClientIdByAltegio;
            }
          } else {
            existingClientId = existingClientIdByAltegio;
          }
        } else if (existingClientIdByName && !existingClientId) {
          existingClientId = existingClientIdByName;
        }

        // Діагностика для цільового клієнта
        if (clientId === TARGET_CLIENT_ID) {
          console.log(`[sync-today-webhooks] 🔍 Client lookup for target client ${TARGET_CLIENT_ID}:`, {
            existingClientId,
            existingClientIdByAltegio: existingAltegioIdMap.get(parseInt(String(clientId), 10)),
            existingClientIdByInstagram: normalizedInstagram ? existingInstagramMap.get(normalizedInstagram) : null,
            normalizedInstagram,
            instagram,
            firstName,
            lastName,
            existingDirectClientsCount: existingDirectClients.length,
            foundInDb: !!existingClientId,
          });
        }

        if (existingClientId) {
          // Оновлюємо існуючого клієнта
          const existingClient = existingDirectClients.find((c) => c.id === existingClientId);
          
          // Діагностика для цільового клієнта
          if (clientId === TARGET_CLIENT_ID) {
            console.log(`[sync-today-webhooks] 🔍 Found existing client for target ${TARGET_CLIENT_ID}:`, {
              existingClientId,
              hasExistingClient: !!existingClient,
              existingClientState: existingClient?.state,
              existingClientInstagram: existingClient?.instagramUsername,
              existingClientAltegioId: existingClient?.altegioClientId,
            });
          }
          
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
            await saveDirectClient(updated, 'sync-today-webhooks', { altegioClientId: parseInt(String(clientId), 10) }, { touchUpdatedAt: false });
            
            // Діагностика для цільового клієнта
            if (clientId === TARGET_CLIENT_ID) {
              console.log(`[sync-today-webhooks] ✅ Updated target client ${TARGET_CLIENT_ID} (${updated.id}):`, {
                instagramUsername: updated.instagramUsername,
                state: updated.state,
                firstName: updated.firstName,
                lastName: updated.lastName,
              });
            }
            
            // Якщо клієнт знайдений за іменем, логуємо це
            if (existingClientIdByName && existingClientId === existingClientIdByName) {
              console.log(`[sync-today-webhooks] ✅ Found and updated client by name "${firstName} ${lastName}": ${updated.id}, set altegioClientId: ${clientId}`);
            }
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
            if (isRecordEvent) {
              try {
                // Діагностика для цільового клієнта
                if (clientId === TARGET_CLIENT_ID) {
                  console.log(`[sync-today-webhooks] 🔍 Starting record event processing for target client ${TARGET_CLIENT_ID}`);
                }
                
                // Перевіряємо services в різних місцях для сумісності з конвертованими подіями
                const servicesFromBody = event.body?.data?.services;
                const servicesFromRecord = event.isFromRecordsLog ? 
                  (event.originalRecord?.data?.services || 
                   (event.originalRecord?.serviceName ? 
                     [{ title: event.originalRecord.serviceName, name: event.originalRecord.serviceName }] : null)) : null;
                const servicesArray = servicesFromBody || servicesFromRecord || [];
                const hasServices = Array.isArray(servicesArray) && servicesArray.length > 0;
                
                // Діагностика для цільового клієнта
                if (clientId === TARGET_CLIENT_ID) {
                  console.log(`[sync-today-webhooks] 🔍 Services extraction for target client ${TARGET_CLIENT_ID}:`, {
                    hasServices,
                    servicesFromBody: !!servicesFromBody,
                    servicesFromRecord: !!servicesFromRecord,
                    servicesArrayLength: servicesArray.length,
                    servicesArray: servicesArray.map((s: any) => ({ title: s.title || s.name, name: s.name })),
                    isFromRecordsLog: event.isFromRecordsLog,
                  });
                }
                
                // Визначаємо змінні для обробки record events (використовуються в обох блоках: консультації та services)
                const data = event.body?.data || {};
                const staffName = data.staff?.name || 
                                data.staff?.display_name || 
                                (event.isFromRecordsLog && event.originalRecord?.staffName) ||
                                null;
                const staffId = data.staff?.id || data.staff_id || null;
                const datetime = data.datetime || 
                               (event.isFromRecordsLog && event.originalRecord?.datetime) ||
                               null;
                
                // Перевіряємо, чи є послуга "Консультація" (використовується в обох блоках)
                // ВАЖЛИВО: Визначаємо hasConsultation назовні блоку if (hasServices), щоб він був доступний для обробки services
                const hasConsultation = servicesArray.some((s: any) => {
                  const title = s.title || s.name || '';
                  return /консультація/i.test(title);
                });
                
                console.log(`[sync-today-webhooks] 🔍 Record event for client ${clientId}:`, {
                  isFromRecordsLog: event.isFromRecordsLog,
                  hasServices,
                  hasConsultation,
                  servicesFromBody: !!servicesFromBody,
                  servicesFromRecord: !!servicesFromRecord,
                  servicesArrayLength: servicesArray.length,
                  servicesArray: servicesArray.map((s: any) => ({ title: s.title || s.name, name: s.name })),
                });
                
                if (hasServices) {
                  // attendance / visit_attendance:
                  //  0   – подія ще не настала (запис існує, але не відбулася)
                  //  1   – клієнт прийшов (фактична консультація)
                  // -1   – клієнт не з'явився
                  // null/undefined – ще не відмічено
                  const attendance =
                    (data as any).attendance ??
                    (data as any).visit_attendance ??
                    (event.isFromRecordsLog &&
                      ((event.originalRecord?.data as any)?.attendance ??
                        (event.originalRecord as any)?.attendance)) ??
                    undefined;
                  const isArrived = attendance === 1 || attendance === 2;
                  const isNotArrived = attendance !== 1 && attendance !== 2;
                  
                  console.log(`[sync-today-webhooks] 🔍 Record event data for client ${clientId}:`, {
                    staffName,
                    attendance,
                    datetime,
                    hasDataStaff: !!data.staff,
                    originalRecordStaffName: event.isFromRecordsLog ? event.originalRecord?.staffName : undefined,
                  });
                  
                  if (hasConsultation && datetime) {
                    console.log(`[sync-today-webhooks] 🔍 Processing consultation for client ${updated.id} (${updated.instagramUsername}):`, {
                      staffName,
                      attendance,
                      datetime,
                      status,
                      clientId,
                      isFromRecordsLog: event.isFromRecordsLog,
                    });
                    
                    // Імпортуємо функції для обробки консультацій
                    const { getMasterByName } = await import('@/lib/direct-masters/store');
                    
                    // Перевіряємо, чи staffName є адміністратором
                    const getAllDirectMasters = (await import('@/lib/direct-masters/store')).getAllDirectMasters;
                    const masters = await getAllDirectMasters();
                    const wasAdminStaff = staffName ? !!masters.find(m => 
                      m.name === staffName && (m.role === 'admin' || m.role === 'direct-manager')
                    ) : false;
                    
                    console.log(`[sync-today-webhooks] 🔍 Consultation check for ${updated.id}:`, {
                      wasAdminStaff,
                      staffName,
                      attendance,
                      status,
                    });
                    
                    // Перевіряємо, чи в історії станів клієнта вже є консультації
                    const { getStateHistory } = await import('@/lib/direct-state-log');
                    const history = await getStateHistory(updated.id);
                    const consultationStates = ['consultation', 'consultation-booked', 'consultation-no-show', 'consultation-rescheduled'];
                    const hadConsultationBefore = history.some(log => consultationStates.includes(log.state || ''));
                    
                    console.log(`[sync-today-webhooks] 🔍 Consultation history for ${updated.id}:`, {
                      hadConsultationBefore,
                      historyStates: history.map(h => h.state),
                    });
                    
                    // Обробка запису на консультацію (ПЕРША консультація)
                    // Встановлюємо 'consultation-booked' якщо є запис на консультацію і ще не було консультацій
                    // Якщо клієнт ще не прийшов (не 1/2) - встановлюємо 'consultation-booked'
                    if ((status === 'create' || status === 'update') && !hadConsultationBefore && isNotArrived) {
                      const consultationUpdates = {
                        state: 'consultation-booked' as const,
                        consultationBookingDate: datetime,
                        // Очищаємо paidServiceDate для консультацій
                        paidServiceDate: undefined,
                        signedUpForPaidService: false,
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
                      }, { touchUpdatedAt: false });
                      
                      console.log(`[sync-today-webhooks] ✅ Set consultation-booked state for client ${updated.id} (status: ${status}, attendance: ${attendance})`);
                    }
                    // Оновлення consultationBookingDate для клієнтів зі станом consultation-booked
                    // Якщо клієнт вже має стан consultation-booked, але дата оновилась або не була встановлена
                    else if ((status === 'create' || status === 'update') && 
                             (updated.state === 'consultation-booked' as any) && 
                             isNotArrived && 
                             datetime) {
                      // Оновлюємо consultationBookingDate, якщо він відсутній або змінився
                      if (!updated.consultationBookingDate || updated.consultationBookingDate !== datetime) {
                        const consultationDateUpdates = {
                          consultationBookingDate: datetime,
                          updatedAt: new Date().toISOString(),
                        };
                        
                        const consultationDateUpdated = {
                          ...updated,
                          ...consultationDateUpdates,
                        };
                        
                        await saveDirectClient(consultationDateUpdated, 'sync-today-webhooks-update-consultation-booking-date', {
                          altegioClientId: clientId,
                          staffName,
                          datetime,
                          oldDate: updated.consultationBookingDate,
                        }, { touchUpdatedAt: false });
                        
                        console.log(`[sync-today-webhooks] ✅ Updated consultationBookingDate for client ${updated.id} (${updated.consultationBookingDate} -> ${datetime})`);
                      }
                    }
                    // Встановлення consultationBookingDate для ВСІХ клієнтів з консультацією
                    // Якщо consultationBookingDate відсутній або змінився, встановлюємо його незалежно від стану
                    // Це fallback логіка, яка спрацьовує, якщо попередні блоки не спрацювали
                    if ((status === 'create' || status === 'update') && 
                        datetime && 
                        isNotArrived &&
                        (!updated.consultationBookingDate || updated.consultationBookingDate !== datetime)) {
                      // Перевіряємо, чи не встановили consultationBookingDate в попередніх блоках
                      // Якщо ні - встановлюємо його тут
                      const consultationDateUpdates = {
                        consultationBookingDate: datetime,
                        updatedAt: new Date().toISOString(),
                      };
                      
                      const consultationDateUpdated = {
                        ...updated,
                        ...consultationDateUpdates,
                      };
                      
                      await saveDirectClient(consultationDateUpdated, 'sync-today-webhooks-set-consultation-booking-date', {
                        altegioClientId: clientId,
                        staffName,
                        datetime,
                        oldDate: updated.consultationBookingDate,
                        currentState: updated.state,
                        hadConsultationBefore,
                        attendance,
                      }, { touchUpdatedAt: false });
                      
                      console.log(`[sync-today-webhooks] ✅ Set consultationBookingDate (fallback) for client ${updated.id} (state: ${updated.state}, ${updated.consultationBookingDate || 'null'} -> ${datetime})`);
                    } else if ((status === 'create' || status === 'update') && datetime && isNotArrived && !updated.consultationBookingDate) {
                      // ДОДАТКОВА ПЕРЕВІРКА: Якщо consultationBookingDate все ще відсутній після всіх блоків
                      // (навіть якщо він не змінився, але його взагалі немає) - встановлюємо його
                      console.log(`[sync-today-webhooks] ⚠️ consultationBookingDate is missing for client ${updated.id}, setting it now (datetime: ${datetime}, attendance: ${attendance}, state: ${updated.state})`);
                      const consultationDateUpdates = {
                        consultationBookingDate: datetime,
                        paidServiceDate: updated.signedUpForPaidService ? updated.paidServiceDate : undefined,
                        signedUpForPaidService: updated.signedUpForPaidService ? updated.signedUpForPaidService : false,
                        updatedAt: new Date().toISOString(),
                      };
                      
                      const consultationDateUpdated = {
                        ...updated,
                        ...consultationDateUpdates,
                      };
                      
                      await saveDirectClient(consultationDateUpdated, 'sync-today-webhooks-set-consultation-booking-date-missing', {
                        altegioClientId: clientId,
                        staffName,
                        datetime,
                        currentState: updated.state,
                        hadConsultationBefore,
                        attendance,
                        reason: 'consultationBookingDate was missing after all blocks',
                      }, { touchUpdatedAt: false });
                      
                      console.log(`[sync-today-webhooks] ✅ Set missing consultationBookingDate for client ${updated.id} (${datetime})`);
                    }
                    // Обробка приходу клієнта на консультацію
                    // Якщо клієнт прийшов на консультацію (attendance 1 або 2), встановлюємо стан 'consultation'
                    else if (isArrived && !wasAdminStaff && staffName && datetime) {
                      // Перевіряємо, чи дата консультації вже настала
                      const consultationDate = new Date(datetime);
                      const now = new Date();
                      const isPastOrToday = consultationDate <= now;
                      
                      console.log(`[sync-today-webhooks] 🔍 Processing consultation attendance for ${updated.id}:`, {
                        attendance,
                        wasAdminStaff,
                        staffName,
                        datetime,
                        consultationDate: consultationDate.toISOString(),
                        now: now.toISOString(),
                        isPastOrToday,
                      });
                      
                      // Якщо дата ще не настала, не встановлюємо стан 'consultation'
                      if (!isPastOrToday) {
                        console.log(`[sync-today-webhooks] ⏭️ Skipping consultation attendance for ${updated.id}: consultation date ${datetime} is in the future`);
                      } else {
                        // Стан `consultation` більше не використовуємо.
                        // Маркер фактичної консультації: consultationAttended === true.
                        const hasActualConsultation = updated.consultationAttended === true;
                        
                        console.log(`[sync-today-webhooks] 🔍 Consultation attendance check for ${updated.id}:`, {
                          hasActualConsultation,
                          consultationAttended: updated.consultationAttended,
                        });
                        
                        // Якщо ще немає фактичної консультації в історії, встановлюємо
                        if (!hasActualConsultation) {
                          const master = await getMasterByName(staffName);
                          console.log(`[sync-today-webhooks] 🔍 Master lookup for "${staffName}":`, {
                            found: !!master,
                            masterId: master?.id,
                            masterName: master?.name,
                          });
                          
                          if (master) {
                            const consultationUpdates = {
                              // НЕ переводимо стан в `consultation` (факт приходу дивимось по ✅ у даті консультації).
                              // Якщо раніше стояв `consultation` — нормалізуємо до `consultation-booked`.
                              state: (String(updated.state) === 'consultation' ? 'consultation-booked' : updated.state) as any,
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
                            }, { touchUpdatedAt: false });
                            
                            console.log(`[sync-today-webhooks] ✅ Marked consultation attended for client ${updated.id}, master: ${master.name}`);
                          } else {
                            console.warn(`[sync-today-webhooks] ⚠️ Master not found for "${staffName}" for client ${updated.id}`);
                          }
                        } else {
                          console.log(`[sync-today-webhooks] ⏭️ Client ${updated.id} already has consultation state in history, skipping`);
                        }
                      }
                    } else {
                      console.log(`[sync-today-webhooks] ⏭️ Skipping consultation attendance for ${updated.id}:`, {
                        attendance,
                        wasAdminStaff,
                        hasStaffName: !!staffName,
                        hasDatetime: !!datetime,
                        reason: isNotArrived ? 'attendance not 1/2' : wasAdminStaff ? 'wasAdminStaff' : !staffName ? 'no staffName' : !datetime ? 'no datetime' : 'unknown',
                      });
                    }
                  }
                  
                  // ОНОВЛЕННЯ СТАНУ КЛІЄНТА НА ОСНОВІ SERVICES (нарощування, інші послуги)
                  // Встановлюємо стан на основі послуг, якщо це не консультація
                  // ВАЖЛИВО: Виконуємо для всіх record events, навіть якщо hasServices false
                  // (services можуть бути в різних місцях структури вебхука)
                  console.log(`[sync-today-webhooks] 🔍 Services processing check for client ${clientId} (${updated.instagramUsername}):`, {
                    isRecordEvent,
                    hasConsultation,
                    servicesArrayLength: servicesArray.length,
                    servicesArray: servicesArray.map((s: any) => ({ title: s.title || s.name, name: s.name })),
                    willProcess: isRecordEvent && !hasConsultation && servicesArray.length > 0,
                    servicesFromBody: !!servicesFromBody,
                    servicesFromRecord: !!servicesFromRecord,
                    eventBodyData: event.body?.data ? Object.keys(event.body.data) : [],
                    originalRecord: event.isFromRecordsLog ? {
                      hasServiceName: !!event.originalRecord?.serviceName,
                      serviceName: event.originalRecord?.serviceName,
                      hasServices: !!event.originalRecord?.data?.services,
                      servicesCount: Array.isArray(event.originalRecord?.data?.services) ? event.originalRecord.data.services.length : 0,
                    } : null,
                  });
                  
                  if (isRecordEvent && !hasConsultation && servicesArray.length > 0) {
                    try {
                      const { determineStateFromServices } = await import('@/lib/direct-state-helper');
                      const { getMasterByAltegioStaffId } = await import('@/lib/direct-masters/store');
                      
                      // Перевіряємо нарощування ПЕРЕД визначенням стану
                      const hasHairExtension = servicesArray.some((s: any) => {
                        const title = s.title || s.name || '';
                        return /нарощування/i.test(title);
                      });
                      
                      const newState = determineStateFromServices(servicesArray);
                      
                      console.log(`[sync-today-webhooks] 🔍 Processing services for client ${updated.id}:`, {
                        hasHairExtension,
                        newState,
                        servicesCount: servicesArray.length,
                        services: servicesArray.map((s: any) => ({ title: s.title || s.name, name: s.name })),
                        hasConsultation,
                        datetime,
                      });
                      
                      // Отримуємо актуальний стан клієнта (може бути оновлено після консультації)
                      const currentClient = existingDirectClients.find(
                        (c) => c.id === updated.id
                      ) || updated;
                      
                      const previousState = currentClient.state;
                      
                      // Визначаємо фінальний стан: якщо newState null, але є нарощування, встановлюємо 'hair-extension'
                      const finalState = newState || (hasHairExtension ? 'hair-extension' : null);
                      
                      // Оновлюємо стан, якщо він змінився АБО якщо є нарощування і потрібно встановити paidServiceDate
                      const needsStateUpdate = finalState && previousState !== finalState;
                      const needsPaidServiceDate = hasHairExtension && datetime && 
                        (!currentClient.paidServiceDate || new Date(currentClient.paidServiceDate) < new Date(datetime));
                      
                      console.log(`[sync-today-webhooks] 🔍 State update check for client ${updated.id}:`, {
                        previousState,
                        newState,
                        finalState,
                        needsStateUpdate,
                        needsPaidServiceDate,
                        hasHairExtension,
                        datetime,
                        currentPaidServiceDate: currentClient.paidServiceDate,
                      });
                      
                      // ВАЖЛИВО: Виконуємо оновлення якщо потрібно оновити стан АБО якщо є нарощування (навіть якщо стан не змінився)
                      // Це гарантує, що paidServiceDate буде встановлено для всіх записів на нарощування
                      if (needsStateUpdate || needsPaidServiceDate || (hasHairExtension && datetime && !hasConsultation)) {
                          const stateUpdates: Partial<typeof currentClient> = {
                            updatedAt: new Date().toISOString(),
                          };
                          
                          // Оновлюємо стан, якщо він змінився
                          if (needsStateUpdate && finalState) {
                            stateUpdates.state = finalState;
                          }
                          
                          // Оновлюємо дату запису (paidServiceDate) для платних послуг (нарощування)
                          // ВАЖЛИВО: Встановлюємо paidServiceDate завжди, якщо є нарощування та дата
                          // Не перезаписувати, якщо платний блок позначено як видалений в Altegio (404)
                          if (hasHairExtension && datetime && !hasConsultation && !(currentClient as any).paidServiceDeletedInAltegio) {
                            const appointmentDate = new Date(datetime);
                            const now = new Date();
                            
                            if (appointmentDate > now) {
                              // Запис в майбутньому - встановлюємо paidServiceDate
                              stateUpdates.paidServiceDate = datetime;
                              stateUpdates.signedUpForPaidService = true;
                              (stateUpdates as any).paidServiceDeletedInAltegio = false;
                              console.log(`[sync-today-webhooks] 🔵 Will set paidServiceDate (future appointment): ${datetime}`);
                            } else if (!currentClient.paidServiceDate || new Date(currentClient.paidServiceDate) < appointmentDate) {
                              // Запис в минулому або поточному - встановлюємо paidServiceDate, якщо його немає або він старіший
                              stateUpdates.paidServiceDate = datetime;
                              stateUpdates.signedUpForPaidService = true;
                              (stateUpdates as any).paidServiceDeletedInAltegio = false;
                              console.log(`[sync-today-webhooks] 🔵 Will set paidServiceDate (past/current appointment): ${datetime}`);
                            } else {
                              console.log(`[sync-today-webhooks] ⏭️ Skipping paidServiceDate update: existing date ${currentClient.paidServiceDate} is newer or same as ${datetime}`);
                            }
                          }
                          
                          // Автоматично призначаємо майстра для нарощування
                          if (hasHairExtension && staffId && !currentClient.masterManuallySet) {
                            const master = await getMasterByAltegioStaffId(staffId);
                            if (master) {
                              stateUpdates.masterId = master.id;
                              console.log(`[sync-today-webhooks] Auto-assigned master ${master.name} (${master.id}) by staff_id ${staffId} to client ${currentClient.id}`);
                            }
                          }
                          
                          const stateUpdated = {
                            ...currentClient,
                            ...stateUpdates,
                          };
                          
                          const metadata = {
                            altegioClientId: clientId,
                            visitId: event.body?.data?.id,
                            services: servicesArray.map((s: any) => ({ id: s.id, title: s.title || s.name })),
                            staffName,
                            masterId: stateUpdates.masterId,
                            previousState,
                            newState: finalState || previousState,
                            needsStateUpdate,
                            needsPaidServiceDate,
                          };
                          
                          await saveDirectClient(stateUpdated, 'sync-today-webhooks-services-state', metadata, { touchUpdatedAt: false });
                          
                          if (needsStateUpdate && finalState) {
                            console.log(`[sync-today-webhooks] ✅ Updated client ${currentClient.id} state from '${previousState}' to '${finalState}' based on services`);
                          }
                          if (needsPaidServiceDate) {
                            console.log(`[sync-today-webhooks] ✅ Updated client ${currentClient.id} paidServiceDate to ${datetime} for hair extension service`);
                          }
                        } else {
                          console.log(`[sync-today-webhooks] ⏭️ Skipping state update for client ${updated.id}:`, {
                            previousState,
                            finalState,
                            needsStateUpdate,
                            needsPaidServiceDate,
                            hasHairExtension,
                          });
                        }
                    } catch (stateErr) {
                      console.error(`[sync-today-webhooks] ⚠️ Failed to process state from services:`, stateErr);
                      // Не зупиняємо обробку через помилку
                    }
                  } else {
                    // Логуємо, чому логіка не спрацювала
                    console.log(`[sync-today-webhooks] ⏭️ Skipping services processing for client ${clientId} (${updated.instagramUsername}):`, {
                      isRecordEvent,
                      hasConsultation,
                      servicesArrayLength: servicesArray.length,
                      reason: !isRecordEvent ? 'not a record event' : hasConsultation ? 'has consultation service' : servicesArray.length === 0 ? 'no services in array' : 'unknown',
                    });
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
                    await saveDirectClient(updatedDuplicate, 'sync-today-webhooks-duplicate', { altegioClientId: parseInt(String(clientId), 10) }, { touchUpdatedAt: false });
                    
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
          await saveDirectClient(newClient, 'sync-today-webhooks-create', { altegioClientId: parseInt(String(clientId), 10) }, { touchUpdatedAt: false });
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

