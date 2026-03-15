// web/app/api/admin/direct/client-webhooks/route.ts
// API endpoint для отримання webhook-ів конкретного клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getKvConfigStatus, kvRead } from '@/lib/kv';
import { groupRecordsByClientDay, normalizeRecordsLogItems } from '@/lib/altegio/records-grouping';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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
    const kvStatus = getKvConfigStatus();
    if (!kvStatus.hasBaseUrl || !kvStatus.hasReadToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'KV не налаштовано локально. Додайте KV_REST_API_URL та KV_REST_API_READ_ONLY_TOKEN (або KV_REST_API_TOKEN) у web/.env.local і перезапустіть dev-сервер.',
          debug: { kvStatus },
        },
        { status: 503 }
      );
    }

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
    
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);
    const groups = groupsByClient.get(altegioClientId) || [];

    const tableRows = groups.map((g, idx) => ({
      receivedAt: g.receivedAt,
      datetime: g.datetime,
      clientName: 'Клієнт',
      staffName: g.staffNames.length ? g.staffNames.join(', ') : 'Невідомий майстер',
      services: g.services.map((s: any) => (s?.title || s?.name || 'Невідома послуга').toString()),
      visitId: g.events.find((e) => typeof e.visitId === 'number')?.visitId || idx + 1,
      status: g.groupType === 'consultation' ? 'consultation-group' : 'paid-group',
      attendance: g.attendance, // -2 => 🚫 Скасовано
      instagramUsername: null,
      fullBody: {
        group: {
          kyivDay: g.kyivDay,
          groupType: g.groupType,
          attendanceStatus: g.attendanceStatus,
          attendance: g.attendance,
        },
        events: g.events,
      },
    }));

    console.log(`[client-webhooks] ✅ Completed grouped fetch for altegioClientId: ${altegioClientId}, events=${normalizedEvents.length}, groups=${groups.length}`);
    const cleanRows = tableRows;

    return NextResponse.json({
      ok: true,
      altegioClientId,
      total: cleanRows.length,
      rows: cleanRows,
      debug: {
        webhookEvents: rawItemsWebhook.length,
        recordEvents: rawItemsRecords.length,
        normalized: normalizedEvents.length,
        groups: groups.length,
        kvStatus,
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

