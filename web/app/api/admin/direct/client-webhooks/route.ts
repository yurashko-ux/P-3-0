// web/app/api/admin/direct/client-webhooks/route.ts
// API endpoint для отримання webhook-ів конкретного клієнта

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
 * GET - отримати webhook-и конкретного клієнта
 * Query params: altegioClientId (number) - ID клієнта в Altegio
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const altegioClientIdParam = req.nextUrl.searchParams.get('altegioClientId');
    if (!altegioClientIdParam) {
      return NextResponse.json({ error: 'altegioClientId is required' }, { status: 400 });
    }

    const altegioClientId = parseInt(altegioClientIdParam, 10);
    if (isNaN(altegioClientId)) {
      return NextResponse.json({ error: 'Invalid altegioClientId' }, { status: 400 });
    }

    // Отримуємо всі webhook events (до 1000 для пошуку)
    // Перевіряємо обидва джерела: webhook:log та records:log
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 999);
    
    // Об'єднуємо обидва джерела
    const rawItems = [...rawItemsWebhook, ...rawItemsRecords];
    const events = rawItems
      .map((raw) => {
        try {
          let parsed: any;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else {
            parsed = raw;
          }
          
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          
          // Конвертуємо events з records:log у формат webhook events
          // records:log містить об'єкти з полями: visitId, recordId, clientId, datetime, etc.
          // webhook:log містить об'єкти з полями: body, receivedAt
          if (parsed && parsed.visitId && !parsed.body) {
            // Це event з records:log - конвертуємо в формат webhook
            // Витягуємо services з parsed.data.services (якщо є) або з parsed.services
            let services: any[] = [];
            if (parsed.data && parsed.data.services) {
              // Може бути масив або JSON-рядок
              if (Array.isArray(parsed.data.services)) {
                services = parsed.data.services;
                console.log(`[client-webhooks] 📦 Found services array in parsed.data.services:`, services.map((s: any) => s.title || s.name || s));
              } else if (typeof parsed.data.services === 'string') {
                try {
                  const parsedServices = JSON.parse(parsed.data.services);
                  services = Array.isArray(parsedServices) ? parsedServices : [];
                  console.log(`[client-webhooks] 📦 Parsed services from JSON string:`, services.map((s: any) => s.title || s.name || s));
                } catch {
                  services = [];
                  console.warn(`[client-webhooks] ⚠️ Failed to parse services JSON string:`, parsed.data.services);
                }
              }
            } else if (parsed.services) {
              if (Array.isArray(parsed.services)) {
                services = parsed.services;
                console.log(`[client-webhooks] 📦 Found services array in parsed.services:`, services.map((s: any) => s.title || s.name || s));
              } else if (typeof parsed.services === 'string') {
                try {
                  const parsedServices = JSON.parse(parsed.services);
                  services = Array.isArray(parsedServices) ? parsedServices : [];
                  console.log(`[client-webhooks] 📦 Parsed services from JSON string (parsed.services):`, services.map((s: any) => s.title || s.name || s));
                } catch {
                  services = [];
                  console.warn(`[client-webhooks] ⚠️ Failed to parse services JSON string (parsed.services):`, parsed.services);
                }
              }
            } else if (parsed.serviceName) {
              services = [{ title: parsed.serviceName }];
              console.log(`[client-webhooks] 📦 Using parsed.serviceName:`, parsed.serviceName);
            } else {
              console.log(`[client-webhooks] ⚠️ No services found in record. Parsed keys:`, Object.keys(parsed), `parsed.data keys:`, parsed.data ? Object.keys(parsed.data) : 'no data');
            }
            
            return {
              body: {
                resource: 'record',
                resource_id: parsed.visitId,
                status: parsed.status || 'create',
                data: {
                  datetime: parsed.datetime,
                  client: parsed.client ? { id: parsed.clientId || parsed.client.id } : { id: parsed.clientId },
                  staff: parsed.staff ? { name: parsed.staffName || parsed.staff.name } : { name: parsed.staffName },
                  services: services,
                  attendance: parsed.attendance,
                  visit_attendance: parsed.visit_attendance,
                },
              },
              receivedAt: parsed.receivedAt || parsed.datetime,
              isFromRecordsLog: true,
              originalRecord: parsed,
            };
          }
          
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Фільтруємо тільки record events для цього клієнта
    const tableRows = events
      .filter((e: any) => {
        // Перевіряємо, чи це record event
        // Може бути e.body?.resource === 'record' або e.isFromRecordsLog === true
        const isRecordEvent = e.body?.resource === 'record' || e.isFromRecordsLog;
        if (!isRecordEvent) return false;
        
        // Перевіряємо, чи це вебхук для нашого клієнта
        // client.id може бути в різних форматах: число, рядок, або вкладений об'єкт
        // Також може бути в e.originalRecord.clientId (для конвертованих events)
        const data = e.body?.data || {};
        const originalRecord = e.originalRecord || {};
        
        const clientId = data.client?.id || originalRecord.clientId;
        const clientIdFromData = data.client_id || originalRecord.client_id;
        
        // Спробуємо різні способи отримання clientId
        let foundClientId: number | null = null;
        
        if (clientId) {
          const parsed = parseInt(String(clientId), 10);
          if (!isNaN(parsed)) {
            foundClientId = parsed;
          }
        } else if (clientIdFromData) {
          const parsed = parseInt(String(clientIdFromData), 10);
          if (!isNaN(parsed)) {
            foundClientId = parsed;
          }
        }
        
        return foundClientId === altegioClientId;
      })
      .map((e: any) => {
        // Обробляємо як звичайні webhook events, так і events з records:log
        const body = e.body || {};
        const data = body.data || e.data || {};
        const originalRecord = e.originalRecord || {};
        
        // Витягуємо services (може бути масив або один об'єкт)
        // Фільтруємо "Запис" - це не послуга, а тип запису
        let services: string[] = [];
        if (Array.isArray(data.services) && data.services.length > 0) {
          const allServices = data.services.map((s: any) => s.title || s.name || 'Невідома послуга');
          console.log(`[client-webhooks] 🔍 Processing services array (${allServices.length} items):`, allServices);
          services = allServices.filter((s: string) => {
            const isZapis = s.toLowerCase() === 'запис';
            if (isZapis) {
              console.log(`[client-webhooks] 🚫 Filtered out "Запис" from services:`, s);
            }
            return !isZapis;
          });
          console.log(`[client-webhooks] ✅ Final services after filtering (${services.length} items):`, services);
        } else if (data.service) {
          const serviceName = data.service.title || data.service.name || 'Невідома послуга';
          console.log(`[client-webhooks] 🔍 Processing single service:`, serviceName);
          if (serviceName.toLowerCase() !== 'запис') {
            services = [serviceName];
            console.log(`[client-webhooks] ✅ Added service:`, serviceName);
          } else {
            console.log(`[client-webhooks] 🚫 Filtered out "Запис":`, serviceName);
          }
        } else if (data.service_id || data.serviceName || originalRecord.serviceName) {
          const serviceName = data.serviceName || originalRecord.serviceName || 'Невідома послуга';
          console.log(`[client-webhooks] 🔍 Processing serviceName:`, serviceName);
          if (serviceName.toLowerCase() !== 'запис') {
            services = [serviceName];
            console.log(`[client-webhooks] ✅ Added serviceName:`, serviceName);
          } else {
            console.log(`[client-webhooks] 🚫 Filtered out "Запис" (serviceName):`, serviceName);
          }
        } else {
          console.log(`[client-webhooks] ⚠️ No services found. data.services:`, data.services, `data.service:`, data.service, `originalRecord.serviceName:`, originalRecord.serviceName);
        }
        
        // Дата вебхука
        const receivedAt = (e.receivedAt || originalRecord.receivedAt) ? new Date(e.receivedAt || originalRecord.receivedAt).toISOString() : null;
        
        // Дата послуг
        const datetime = (data.datetime || originalRecord.datetime) ? new Date(data.datetime || originalRecord.datetime).toISOString() : null;
        
        // Client name
        const clientName = data.client?.display_name || data.client?.name || originalRecord.clientName || 'Невідомий клієнт';
        
        // Staff name
        const staffName = data.staff?.name || data.staff?.display_name || originalRecord.staffName || 'Невідомий майстер';
        
        // Attendance
        const attendance = data.attendance ?? data.visit_attendance ?? originalRecord.attendance ?? originalRecord.visit_attendance ?? null;
        
        // Instagram username з custom_fields
        let instagramUsername: string | null = null;
        const client = data.client || originalRecord.client || {};
        if (client.custom_fields) {
          // Варіант 1: custom_fields - це масив об'єктів
          if (Array.isArray(client.custom_fields)) {
            for (const field of client.custom_fields) {
              if (field && typeof field === 'object') {
                const title = field.title || field.name || field.label || '';
                const value = field.value || field.data || field.content || field.text || '';
                
                if (value && typeof value === 'string' && /instagram/i.test(title)) {
                  instagramUsername = value.trim();
                  break;
                }
              }
            }
          }
          // Варіант 2: custom_fields - це об'єкт з ключами
          else if (typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
            instagramUsername =
              client.custom_fields['instagram-user-name'] ||
              client.custom_fields['Instagram user name'] ||
              client.custom_fields.instagram_user_name ||
              client.custom_fields.instagramUsername ||
              client.custom_fields.instagram ||
              client.custom_fields['instagram'] ||
              null;
            
            if (instagramUsername && typeof instagramUsername === 'string') {
              instagramUsername = instagramUsername.trim();
            }
          }
        }
        
        return {
          receivedAt,
          datetime,
          clientName,
          staffName,
          services: services.length > 0 ? services : ['Невідома послуга'],
          visitId: body.resource_id || originalRecord.visitId,
          status: body.status || originalRecord.status || 'create',
          attendance,
          instagramUsername: instagramUsername || null,
          fullBody: body,
        };
      })
      .filter((row: any) => row.receivedAt) // Фільтруємо записи без дати
      .sort((a: any, b: any) => {
        // Сортуємо за датою вебхука (найновіші спочатку)
        if (!a.receivedAt) return 1;
        if (!b.receivedAt) return -1;
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      });

    // Діагностична інформація для дебагу
    const recordEvents = events.filter((e: any) => e.body?.resource === 'record');
    const debugInfo = {
      totalEvents: events.length,
      recordEvents: recordEvents.length,
      matchedEvents: tableRows.length,
      searchedClientId: altegioClientId,
      sampleClientIds: recordEvents
        .slice(0, 10)
        .map((e: any) => ({
          clientId: e.body?.data?.client?.id,
          clientIdType: typeof e.body?.data?.client?.id,
          clientIdFromData: e.body?.data?.client_id,
          clientName: e.body?.data?.client?.display_name || e.body?.data?.client?.name,
        })),
    };

    return NextResponse.json({
      ok: true,
      altegioClientId,
      total: tableRows.length,
      rows: tableRows,
      debug: debugInfo, // Додаємо для діагностики
    });
  } catch (error) {
    console.error('[direct/client-webhooks] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

