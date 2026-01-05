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
            return {
              body: {
                resource: 'record',
                resource_id: parsed.visitId,
                status: parsed.status || 'create',
                data: {
                  datetime: parsed.datetime,
                  client: parsed.client ? { id: parsed.clientId || parsed.client.id } : { id: parsed.clientId },
                  staff: parsed.staff ? { name: parsed.staffName || parsed.staff.name } : { name: parsed.staffName },
                  services: parsed.services || (parsed.serviceName ? [{ title: parsed.serviceName }] : []),
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
        if (e.body?.resource !== 'record') return false;
        
        // Перевіряємо, чи це вебхук для нашого клієнта
        // client.id може бути в різних форматах: число, рядок, або вкладений об'єкт
        const clientId = e.body?.data?.client?.id;
        const clientIdFromData = e.body?.data?.client_id;
        
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
        
        // Витягуємо services (може бути масив або один об'єкт)
        let services: string[] = [];
        if (Array.isArray(data.services) && data.services.length > 0) {
          services = data.services.map((s: any) => s.title || s.name || 'Невідома послуга');
        } else if (data.service) {
          services = [data.service.title || data.service.name || 'Невідома послуга'];
        } else if (data.service_id || data.serviceName) {
          services = [data.serviceName || 'Невідома послуга'];
        }
        
        // Дата вебхука
        const receivedAt = e.receivedAt ? new Date(e.receivedAt).toISOString() : null;
        
        // Дата послуг
        const datetime = data.datetime ? new Date(data.datetime).toISOString() : null;
        
        // Client name
        const clientName = data.client?.display_name || data.client?.name || 'Невідомий клієнт';
        
        // Staff name
        const staffName = data.staff?.name || data.staff?.display_name || 'Невідомий майстер';
        
        // Attendance
        const attendance = data.attendance ?? data.visit_attendance ?? null;
        
        return {
          receivedAt,
          datetime,
          clientName,
          staffName,
          services: services.length > 0 ? services : ['Невідома послуга'],
          visitId: body.resource_id,
          status: body.status,
          attendance,
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

