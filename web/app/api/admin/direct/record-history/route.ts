// web/app/api/admin/direct/record-history/route.ts
// Історія записів/консультацій з Altegio (records/webhook log) для конкретного клієнта.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { computeServicesTotalCostUAH, groupRecordsByClientDay, normalizeRecordsLogItems } from '@/lib/altegio/records-grouping';
import { prisma } from '@/lib/prisma';

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
  // 1 = прийшов, 2 = підтвердив запис (Altegio) — обидва показуємо як «Прийшов»
  if (attendance === 1 || attendance === 2) return { icon: '✅', label: 'Прийшов' };
  if (attendance === -2 || status === 'cancelled') return { icon: '🚫', label: 'Скасовано' };
  if (attendance === -1) return { icon: '❌', label: "Не з'явився" };
  if (attendance === 0) return { icon: '⏳', label: 'Очікується' };
  return { icon: '❓', label: 'Невідомо' };
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

    // Беремо records:log як основне джерело (там найповніша історія).
    // webhook:log як доповнення (часто там менше івентів).
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);

    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
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
        attendance: g.attendance,
        attendanceStatus: g.attendanceStatus,
        attendanceIcon: ui.icon,
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
        recordsLogCount: rawItemsRecords.length,
        webhookLogCount: rawItemsWebhook.length,
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

