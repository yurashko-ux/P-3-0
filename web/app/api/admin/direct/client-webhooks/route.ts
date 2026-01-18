// web/app/api/admin/direct/client-webhooks/route.ts
// API endpoint для отримання webhook-ів конкретного клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getKvConfigStatus, kvRead } from '@/lib/kv';
import { groupRecordsByClientDay, normalizeRecordsLogItems } from '@/lib/altegio/records-grouping';

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
    const host = req.headers.get('host') || '';
    const dbgRunId = `cw_${Date.now()}`;
    const dbg = (payload: any) => {
      // #region agent log
      try {
        const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1');
        if (!isLocalHost) return;
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: 'debug-session', runId: dbgRunId, timestamp: Date.now(), ...payload }),
        }).catch(() => {});
      } catch {}
      // #endregion agent log
    };

    const kvStatus = getKvConfigStatus();
    if (!kvStatus.hasBaseUrl || !kvStatus.hasReadToken) {
      dbg({
        hypothesisId: 'KV0',
        location: 'client-webhooks/route.ts:kvMissing',
        message: 'KV не налаштовано: не можемо читати altegio:webhook:log',
        data: {
          hasBaseUrl: kvStatus.hasBaseUrl,
          hasReadToken: kvStatus.hasReadToken,
          hasWriteToken: kvStatus.hasWriteToken,
          baseCandidatesCount: kvStatus.baseCandidates.length,
        },
      });
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
    dbg({
      hypothesisId: 'KV1',
      location: 'client-webhooks/route.ts:kvCounts',
      message: 'Зчитали KV логи Altegio',
      data: {
        altegioClientId,
        webhookItems: rawItemsWebhook.length,
        recordsItems: rawItemsRecords.length,
      },
    });
    
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);
    const groups = groupsByClient.get(altegioClientId) || [];

    // Діагностика: інколи attendance приходить як string ("1"), через що UI показує '-'.
    // Логуємо лише технічні поля без PII.
    try {
      const samples: any[] = [];
      for (const g of groups.slice(0, 4)) {
        const evs = Array.isArray((g as any).events) ? (g as any).events : [];
        for (const ev of evs.slice(0, 4)) {
          const raw = (ev as any)?.raw;
          const pick = (val: any) => ({
            v: val ?? null,
            t: val === null ? 'null' : typeof val,
          });
          samples.push({
            kyivDay: (g as any).kyivDay || null,
            groupType: (g as any).groupType || null,
            normalizedAttendance: pick((ev as any)?.attendance),
            rawAttendance: pick(raw?.attendance),
            rawDataAttendance: pick(raw?.data?.attendance),
            rawVisitAttendance: pick(raw?.visit_attendance),
            rawDataVisitAttendance: pick(raw?.data?.visit_attendance),
            rawBodyDataAttendance: pick(raw?.body?.data?.attendance),
            rawBodyDataVisitAttendance: pick(raw?.body?.data?.visit_attendance),
          });
        }
      }
      dbg({
        hypothesisId: 'A1',
        location: 'client-webhooks/route.ts:attendanceRawSamples',
        message: 'Raw attendance samples (types) for this client',
        data: { altegioClientId, groups: groups.length, samples },
      });
    } catch (err) {
      console.warn('[client-webhooks] ⚠️ attendance raw samples failed:', err);
    }

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
    dbg({
      hypothesisId: 'KV2',
      location: 'client-webhooks/route.ts:grouped',
      message: 'Згрупували події по клієнту/дню',
      data: { altegioClientId, normalizedEvents: normalizedEvents.length, groups: groups.length },
    });
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

