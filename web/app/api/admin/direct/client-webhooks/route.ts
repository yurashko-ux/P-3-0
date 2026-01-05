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
    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 999);
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
        const body = e.body || {};
        const data = body.data || {};
        
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

    return NextResponse.json({
      ok: true,
      altegioClientId,
      total: tableRows.length,
      rows: tableRows,
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

