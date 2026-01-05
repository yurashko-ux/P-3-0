// web/app/api/admin/direct/webhooks-table/route.ts
// API endpoint для отримання webhook-ів у форматі таблиці

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
 * GET - отримати webhook-и у форматі таблиці
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000) : 100;

    // Отримуємо webhook events
    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, limit - 1);
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

    // Фільтруємо тільки record events та конвертуємо в формат таблиці
    const tableRows = events
      .filter((e: any) => e.body?.resource === 'record')
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
        
        // Instagram username з custom_fields
        let instagramUsername: string | null = null;
        const client = data.client || {};
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
          visitId: body.resource_id,
          status: body.status,
          instagramUsername: instagramUsername || null,
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
      total: tableRows.length,
      rows: tableRows,
    });
  } catch (error) {
    console.error('[direct/webhooks-table] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
