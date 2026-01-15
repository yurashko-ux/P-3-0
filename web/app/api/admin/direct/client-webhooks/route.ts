// web/app/api/admin/direct/client-webhooks/route.ts
// API endpoint для отримання webhook-ів конкретного клієнта

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { groupRecordsByKyivDay, normalizeRecordLikeEvent } from '@/lib/altegio/records-grouping';

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

    console.log(`[client-webhooks] 🔍 Starting webhooks fetch for altegioClientId: ${altegioClientId}`);

    // Отримуємо всі webhook events (до 1000 для пошуку)
    // Перевіряємо обидва джерела: webhook:log та records:log
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 999);
    
    console.log(`[client-webhooks] 📊 Found ${rawItemsWebhook.length} items in webhook:log, ${rawItemsRecords.length} items in records:log`);
    
    const normalized = [
      ...rawItemsRecords.map((r) => normalizeRecordLikeEvent(r, 'records:log')),
      ...rawItemsWebhook.map((r) => normalizeRecordLikeEvent(r, 'webhook:log')),
    ].filter((e): e is NonNullable<typeof e> => !!e && e.clientId === altegioClientId);

    const grouped = groupRecordsByKyivDay(normalized);

    const tableRows = grouped.map((g, idx) => {
      const clientName =
        g.events.find((e) => e.raw?.data?.client?.name || e.raw?.data?.client?.display_name)?.raw?.data?.client?.name ||
        g.events.find((e) => e.raw?.data?.client?.display_name)?.raw?.data?.client?.display_name ||
        'Клієнт';

      return {
        receivedAt: g.receivedAtLatest,
        datetime: g.datetime,
        clientName,
        staffName: g.staffNames.length ? g.staffNames.join(', ') : 'Невідомий майстер',
        services: g.services.length ? g.services : ['Невідома послуга'],
        // visitId залишаємо як число для сумісності; але це "група", тому беремо або перший visitId, або idx
        visitId: g.events.find((e) => typeof e.visitId === 'number')?.visitId || idx + 1,
        status: g.groupType === 'consultation' ? 'consultation-group' : 'paid-group',
        // -2 => 🚫 Скасовано
        attendance: g.attendance.value,
        instagramUsername: null,
        fullBody: {
          group: {
            key: g.key,
            groupType: g.groupType,
            visitDayKyiv: g.visitDayKyiv,
            attendance: g.attendance,
            staffNames: g.staffNames,
            statuses: g.statuses,
          },
          events: g.events.map((e) => ({
            source: e.source,
            receivedAt: e.receivedAt,
            datetime: e.datetime,
            attendance: e.attendance,
            staffName: e.staffName,
            status: e.status,
          })),
        },
      };
    });

    console.log(`[client-webhooks] ✅ Completed grouped fetch for altegioClientId: ${altegioClientId}, events=${normalized.length}, groups=${grouped.length}`);
    const cleanRows = tableRows;
    
    return NextResponse.json({
      ok: true,
      altegioClientId,
      total: cleanRows.length,
      rows: cleanRows,
      debug: {
        webhookEvents: rawItemsWebhook.length,
        recordEvents: rawItemsRecords.length,
        normalized: normalized.length,
        groups: grouped.length,
      },
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

