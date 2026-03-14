// web/app/api/admin/direct/record-history/route.ts
// Історія записів/консультацій. API-first: Altegio GET /records як джерело.
// Fallback на KV (webhook log), якщо API не відповідає або повертає порожньо.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import { computeServicesTotalCostUAH, groupRecordsByClientDay, normalizeRecordsLogItems } from '@/lib/altegio/records-grouping';
import { prisma } from '@/lib/prisma';
import { getEnvValue } from '@/lib/env';

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

function attendanceUi(attendance: number | null, status: string) {
  // attendance тут вже агрегований: 1 | 0 | -1 | -2 | null
  // 1 = прийшов (зелена галочка), 2 = підтвердив запис (синя галочка)
  if (attendance === 1) return { icon: '✅', label: 'Прийшов', variant: 'green' as const };
  if (attendance === 2) return { icon: '✅', label: 'Підтвердив запис', variant: 'blue' as const };
  if (attendance === -2 || status === 'cancelled') return { icon: '🚫', label: 'Скасовано', variant: null };
  if (attendance === -1) return { icon: '❌', label: "Не з'явився", variant: null };
  if (attendance === 0) return { icon: '⏳', label: 'Очікується', variant: null };
  return { icon: '❓', label: 'Невідомо', variant: null };
}

/**
 * GET - отримати історію по клієнту
 * Query:
 *  - altegioClientId: number (required)
 *  - type: 'paid' | 'consultation' (required)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const altegioClientIdParam = req.nextUrl.searchParams.get('altegioClientId');
    const typeParam = req.nextUrl.searchParams.get('type');

    if (!altegioClientIdParam) {
      return NextResponse.json({ ok: false, error: 'altegioClientId is required' }, { status: 400 });
    }
    const altegioClientId = parseInt(altegioClientIdParam, 10);
    if (isNaN(altegioClientId)) {
      return NextResponse.json({ ok: false, error: 'Invalid altegioClientId' }, { status: 400 });
    }

    const type = typeParam === 'paid' || typeParam === 'consultation' ? typeParam : null;
    if (!type) {
      return NextResponse.json({ ok: false, error: "type must be 'paid' or 'consultation'" }, { status: 400 });
    }

    console.log(`[direct/record-history] 🔍 Fetching history for altegioClientId=${altegioClientId}, type=${type}`);

    // ВАЖЛИВО: Altegio рахує консультацію як “візит”.
    // Правило: консультацію показуємо, якщо visits = 0 або visits = 1.
    // Ігноруємо консультацію тільки коли visits >= 2.
    if (type === 'consultation') {
      try {
        const client = await prisma.directClient.findFirst({
          where: { altegioClientId },
          select: { visits: true },
        });
        const shouldIgnoreConsult = (client?.visits ?? 0) >= 2;
        if (shouldIgnoreConsult) {
          return NextResponse.json({
            ok: true,
            altegioClientId,
            type,
            total: 0,
            rows: [],
            debug: {
              ignoredReason: 'repeat-client-visits>=2',
            },
          });
        }
      } catch (err) {
        console.warn('[direct/record-history] ⚠️ Не вдалося перевірити visits (продовжуємо без фільтра):', err);
      }
    }

    // API-first: Altegio GET /records як джерело. Fallback на KV (webhook log) при помилці.
    let itemsForNormalize: any[] = [];
    let dataSource: 'api' | 'kv' = 'kv';
    let recordsLogCount = 0;
    let webhookLogCount = 0;
    const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
    const companyId = companyIdStr ? parseInt(companyIdStr, 10) : NaN;

    if (Number.isFinite(companyId) && companyId > 0) {
      try {
        const rawRecords = await getClientRecordsRaw(companyId, altegioClientId);
        if (rawRecords.length > 0) {
          const eventsFromApi = rawRecords
            .filter((r: any) => !r?.deleted)
            .map((r: any) => rawRecordToRecordEvent(r, altegioClientId, companyId));
          itemsForNormalize = eventsFromApi;
          dataSource = 'api';
          console.log(`[direct/record-history] ✅ Using API: ${eventsFromApi.length} records for client ${altegioClientId}`);
        }
      } catch (err) {
        console.warn('[direct/record-history] ⚠️ API failed, fallback to KV:', err instanceof Error ? err.message : String(err));
      }
    }

    if (itemsForNormalize.length === 0) {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
      recordsLogCount = rawItemsRecords.length;
      webhookLogCount = rawItemsWebhook.length;
      itemsForNormalize = [...rawItemsRecords, ...rawItemsWebhook];
      console.log(`[direct/record-history] Using KV fallback: records=${recordsLogCount}, webhook=${webhookLogCount}`);
    }

    const normalizedEvents = normalizeRecordsLogItems(itemsForNormalize);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);
    const allGroups = groupsByClient.get(altegioClientId) || [];

    const filtered = allGroups.filter((g) => g.groupType === type);

    const rows = filtered.map((g) => {
      const recordCreatedAt = (() => {
        try {
          const events = Array.isArray((g as any)?.events) ? (g as any).events : [];
          const toTs = (e: any) => new Date(e?.receivedAt || e?.datetime || 0).getTime();

          let bestCreate = Infinity;
          for (const e of events) {
            const status = (e?.status || '').toString();
            if (status !== 'create') continue;
            const ts = toTs(e);
            if (isFinite(ts) && ts < bestCreate) bestCreate = ts;
          }
          if (bestCreate !== Infinity) return new Date(bestCreate).toISOString();

          let bestAny = Infinity;
          for (const e of events) {
            const ts = toTs(e);
            if (isFinite(ts) && ts < bestAny) bestAny = ts;
          }
          if (bestAny !== Infinity) return new Date(bestAny).toISOString();

          return null;
        } catch {
          return null;
        }
      })();

      const ui = attendanceUi(g.attendance, g.attendanceStatus);
      const totalCost = computeServicesTotalCostUAH(g.services || []);
      return {
        kyivDay: g.kyivDay,
        type: g.groupType,
        datetime: g.datetime,
        createdAt: recordCreatedAt,
        receivedAt: g.receivedAt,
        attendanceSetAt: g.attendanceSetAt ?? null,
        attendance: g.attendance,
        attendanceStatus: g.attendanceStatus,
        attendanceIcon: ui.icon,
        attendanceIconVariant: ui.variant,
        attendanceLabel: ui.label,
        staffNames: g.staffNames,
        services: g.services.map((s: any) => (s?.title || s?.name || 'Невідома послуга').toString()),
        totalCost,
        rawEventsCount: g.events.length,
        events: g.events.slice(0, 50).map((e) => ({
          receivedAt: e.receivedAt,
          datetime: e.datetime,
          staffName: e.staffName,
          attendance: e.attendance,
          status: e.status,
          visitId: e.visitId,
        })),
      };
    });

    return NextResponse.json({
      ok: true,
      altegioClientId,
      type,
      total: rows.length,
      rows,
      debug: {
        dataSource,
        recordsLogCount,
        webhookLogCount,
        normalizedCount: normalizedEvents.length,
        allGroupsCount: allGroups.length,
      },
    });
  } catch (error) {
    console.error('[direct/record-history] ❌ Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

