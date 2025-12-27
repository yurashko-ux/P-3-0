// web/app/api/admin/direct/search-webhooks/route.ts
// Пошук вебхуків по Instagram username клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';

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
 * GET - пошук вебхуків по Instagram username
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const instagramUsername = searchParams.get('instagram');
    
    if (!instagramUsername) {
      return NextResponse.json({
        ok: false,
        error: 'Instagram username is required',
      }, { status: 400 });
    }

    const normalizedInstagram = normalizeInstagram(instagramUsername);
    console.log(`[direct/search-webhooks] Searching webhooks for Instagram: ${normalizedInstagram}`);

    // Знаходимо клієнта по Instagram username
    const allClients = await getAllDirectClients();
    const client = allClients.find(
      (c) => normalizeInstagram(c.instagramUsername || '') === normalizedInstagram
    );

    if (!client) {
      return NextResponse.json({
        ok: false,
        error: `Client with Instagram username "${instagramUsername}" not found`,
        searchedInstagram: normalizedInstagram,
      }, { status: 404 });
    }

    console.log(`[direct/search-webhooks] Found client: ${client.id}, Altegio ID: ${client.altegioClientId}`);

    if (!client.altegioClientId) {
      return NextResponse.json({
        ok: true,
        client: {
          id: client.id,
          instagramUsername: client.instagramUsername,
          fullName: client.fullName,
          phone: client.phone,
        },
        webhooks: [],
        records: [],
        message: 'Client has no Altegio client ID',
      });
    }

    const altegioClientId = parseInt(String(client.altegioClientId), 10);

    // Отримуємо вебхуки з webhook log
    const webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 9999);
    console.log(`[direct/search-webhooks] Found ${webhookLogRaw.length} webhooks in log`);

    const webhooks = webhookLogRaw
      .map((raw, index) => {
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
              return null;
            }
          }
          
          // Перевіряємо, чи це вебхук для нашого клієнта
          if (parsed && parsed.body) {
            const body = parsed.body;
            const resource = body.resource; // 'client' або 'record'
            const resourceId = body.resource_id;
            const status = body.status; // 'create', 'update', 'delete'
            const data = body.data || {};
            
            // Для client events
            if (resource === 'client') {
              const clientId = resourceId || data.id;
              if (parseInt(String(clientId), 10) === altegioClientId) {
                return {
                  type: 'client',
                  status,
                  receivedAt: parsed.receivedAt,
                  clientId: clientId,
                  clientName: data.name || data.display_name,
                  hasCustomFields: !!data.custom_fields,
                  customFields: data.custom_fields,
                  fullBody: body,
                };
              }
            }
            
            // Для record events
            if (resource === 'record') {
              const recordClientId = data.client?.id || data.client_id;
              if (recordClientId && parseInt(String(recordClientId), 10) === altegioClientId) {
                const services = Array.isArray(data.services) ? data.services : (data.service ? [data.service] : []);
                return {
                  type: 'record',
                  status,
                  receivedAt: parsed.receivedAt,
                  visitId: data.visit_id || resourceId,
                  recordId: resourceId,
                  datetime: data.datetime,
                  clientId: recordClientId,
                  clientName: data.client?.name || data.client?.display_name,
                  services: services.map((s: any) => ({
                    id: s.id,
                    title: s.title || s.name,
                    cost: s.cost,
                  })),
                  staffId: data.staff?.id || data.staff_id,
                  staffName: data.staff?.name || data.staff?.display_name,
                  attendance: data.attendance || data.visit_attendance,
                  fullBody: body,
                };
              }
            }
          }
          
          return null;
        } catch (err) {
          console.warn(`[direct/search-webhooks] Failed to parse webhook at index ${index}:`, err);
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

    // Отримуємо записи з records log
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[direct/search-webhooks] Found ${recordsLogRaw.length} records in log`);

    const records = recordsLogRaw
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
              return null;
            }
          }
          
          const recordClientId = parsed?.clientId || (parsed?.data && parsed.data.client && parsed.data.client.id);
          if (recordClientId && parseInt(String(recordClientId), 10) === altegioClientId) {
            const services = parsed?.data?.services || parsed?.services || [];
            return {
              visitId: parsed.visitId,
              recordId: parsed.recordId,
              status: parsed.status,
              datetime: parsed.datetime,
              receivedAt: parsed.receivedAt,
              services: Array.isArray(services) ? services.map((s: any) => ({
                id: s.id,
                title: s.title || s.name,
                cost: s.cost,
              })) : [],
              staffId: parsed.staffId,
              serviceId: parsed.serviceId,
              serviceName: parsed.serviceName,
            };
          }
          
          return null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

    return NextResponse.json({
      ok: true,
      client: {
        id: client.id,
        instagramUsername: client.instagramUsername,
        fullName: client.fullName,
        phone: client.phone,
        altegioClientId: client.altegioClientId,
        state: client.state,
      },
      webhooks: webhooks,
      records: records,
      stats: {
        totalWebhooks: webhooks.length,
        clientWebhooks: webhooks.filter((w: any) => w.type === 'client').length,
        recordWebhooks: webhooks.filter((w: any) => w.type === 'record').length,
        totalRecords: records.length,
      },
    });
  } catch (error) {
    console.error('[direct/search-webhooks] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
