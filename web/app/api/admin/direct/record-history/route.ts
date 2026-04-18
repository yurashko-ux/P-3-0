// web/app/api/admin/direct/record-history/route.ts
// Історія записів/консультацій. API-first: Altegio GET /records як джерело.
// Fallback на KV (webhook log), якщо API не відповідає або повертає порожньо.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import {
  computeServicesTotalCostUAH,
  groupRecordsByClientDay,
  kyivDayFromISO,
  normalizeRecordsLogItems,
} from '@/lib/altegio/records-grouping';
import { prisma } from '@/lib/prisma';
import { getEnvValue } from '@/lib/env';
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
    // Правило має збігатися зі списком клієнтів:
    // - консультацію ігноруємо тільки коли visits >= 2 І в клієнта немає активної consultationBookingDate;
    // - якщо consultationBookingDate вже є в direct_clients, історію треба показати навіть для repeat-клієнта.
    if (type === 'consultation') {
      try {
        const client = await prisma.directClient.findFirst({
          where: { altegioClientId },
          select: { visits: true, consultationBookingDate: true },
        });
        const hadConsult = Boolean(client?.consultationBookingDate);
        const shouldIgnoreConsult = (client?.visits ?? 0) >= 2 && !hadConsult;
        if (shouldIgnoreConsult) {
          return NextResponse.json({
            ok: true,
            altegioClientId,
            type,
            total: 0,
            rows: [],
            debug: {
              ignoredReason: 'repeat-client-visits>=2',
              hadConsult,
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

    const mapGroupToRow = (g: (typeof allGroups)[number]) => {
      const recordCreatedAt = (() => {
        try {
          const events = Array.isArray((g as any)?.events) ? (g as any).events : [];
          const toTs = (e: any) => new Date(e?.create_date ?? e?.receivedAt ?? e?.datetime ?? 0).getTime();

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
    };

    const rows = allGroups.filter((g) => g.groupType === type).map(mapGroupToRow);
    const paidRows = allGroups.filter((g) => g.groupType === 'paid').map(mapGroupToRow);
    const consultationRows = allGroups.filter((g) => g.groupType === 'consultation').map(mapGroupToRow);

    let selfHealedPaidAttendance = false;
    let selfHealedConsultationAttendance = false;

    // Вирівнюємо Prisma з тим, що вже пораховано для модалки (групи по днях) — інакше таблиця показує інший 1/2, ніж історія.
    // Виконуємо для всіх платних груп у кеші, не лише коли type=paid — щоб відкриття «Історія консультацій» теж підтягувала платний статус у БД.
    if (paidRows.length > 0) {
      try {
        const dc = await prisma.directClient.findFirst({
          where: { altegioClientId },
          select: {
            id: true,
            paidServiceDate: true,
            paidServiceKyivDay: true,
            paidServiceAttendanceValue: true,
            paidServiceAttended: true,
            paidServiceCancelled: true,
          },
        });
        if (dc?.paidServiceDate) {
          const paidIso =
            typeof dc.paidServiceDate === 'string'
              ? dc.paidServiceDate
              : dc.paidServiceDate instanceof Date
                ? dc.paidServiceDate.toISOString()
                : String(dc.paidServiceDate);
          const paidKyiv = dc.paidServiceKyivDay || kyivDayFromISO(paidIso);
          const rowForDay = paidKyiv ? paidRows.find((r) => r.kyivDay === paidKyiv) : null;
          const target = rowForDay ?? paidRows[0];
          const att = target.attendance;
          const updates: Record<string, unknown> = {};

          if (att === 1 || att === 2) {
            if ((dc.paidServiceAttendanceValue ?? null) !== att) {
              updates.paidServiceAttendanceValue = att;
            }
            if (dc.paidServiceAttended !== true) updates.paidServiceAttended = true;
            if (dc.paidServiceCancelled) updates.paidServiceCancelled = false;
            if (target.attendanceSetAt) {
              updates.paidServiceAttendanceSetAt = new Date(target.attendanceSetAt);
            }
          } else if (att === -1) {
            if (dc.paidServiceAttended !== false) {
              updates.paidServiceAttended = false;
              updates.paidServiceAttendanceValue = null;
            }
          } else if (att === -2 || String(target.attendanceStatus || '') === 'cancelled') {
            if (!dc.paidServiceCancelled) {
              updates.paidServiceCancelled = true;
              updates.paidServiceAttended = null;
              updates.paidServiceAttendanceValue = null;
            }
          }

          if (Object.keys(updates).length > 0) {
            await prisma.directClient.update({ where: { id: dc.id }, data: updates as any });
            selfHealedPaidAttendance = true;
            console.log('[direct/record-history] ✅ Self-heal paid attendance з рядка історії', {
              altegioClientId,
              attendance: att,
              paidKyiv,
            });
          }
        }
      } catch (err) {
        console.warn('[direct/record-history] ⚠️ Не вдалося self-heal paid attendance:', err);
      }
    }

    // Self-heal attendance консультації (аналогічно платному); виконується для всіх consultation-груп у відповіді.
    if (consultationRows.length > 0) {
      try {
        const dc = await prisma.directClient.findFirst({
          where: { altegioClientId },
          select: {
            id: true,
            consultationBookingDate: true,
            consultationBookingKyivDay: true,
            consultationAttendanceValue: true,
            consultationAttended: true,
            consultationCancelled: true,
          },
        });
        if (dc?.consultationBookingDate) {
          const consultIso =
            typeof dc.consultationBookingDate === 'string'
              ? dc.consultationBookingDate
              : dc.consultationBookingDate instanceof Date
                ? dc.consultationBookingDate.toISOString()
                : String(dc.consultationBookingDate);
          const consultKyiv = dc.consultationBookingKyivDay || kyivDayFromISO(consultIso);
          const rowForDay = consultKyiv ? consultationRows.find((r) => r.kyivDay === consultKyiv) : null;
          const target = rowForDay ?? consultationRows[0];
          const att = target.attendance;
          const updates: Record<string, unknown> = {};

          if (att === 1 || att === 2) {
            if ((dc.consultationAttendanceValue ?? null) !== att) {
              updates.consultationAttendanceValue = att;
            }
            if (dc.consultationAttended !== true) updates.consultationAttended = true;
            if (dc.consultationCancelled) updates.consultationCancelled = false;
            if (target.attendanceSetAt) {
              updates.consultationAttendanceSetAt = new Date(target.attendanceSetAt);
            }
          } else if (att === -1) {
            if (dc.consultationAttended !== false) {
              updates.consultationAttended = false;
              updates.consultationAttendanceValue = null;
            }
          } else if (att === -2 || String(target.attendanceStatus || '') === 'cancelled') {
            if (!dc.consultationCancelled) {
              updates.consultationCancelled = true;
              updates.consultationAttended = null;
              updates.consultationAttendanceValue = null;
            }
          }

          if (Object.keys(updates).length > 0) {
            await prisma.directClient.update({ where: { id: dc.id }, data: updates as any });
            selfHealedConsultationAttendance = true;
            console.log('[direct/record-history] ✅ Self-heal consultation attendance з рядка історії', {
              altegioClientId,
              attendance: att,
              consultKyiv,
            });
          }
        }
      } catch (err) {
        console.warn('[direct/record-history] ⚠️ Не вдалося self-heal consultation attendance:', err);
      }
    }

    // Дати бронювання/створення запису консультації — з актуального рядка історії (не лише коли відкрито type=consultation).
    if (consultationRows.length > 0) {
      try {
        const latestRow = consultationRows[0];
        const latestBookingDate = latestRow.datetime ? new Date(latestRow.datetime).toISOString() : null;
        const latestCreatedAt = latestRow.createdAt ? new Date(latestRow.createdAt).toISOString() : null;
        const directClient = await prisma.directClient.findFirst({
          where: { altegioClientId },
          select: {
            id: true,
            consultationBookingDate: true,
            consultationRecordCreatedAt: true,
          },
        });
        if (directClient) {
          const updates: Record<string, Date> = {};
          if (
            latestBookingDate &&
            (
              !directClient.consultationBookingDate ||
              new Date(directClient.consultationBookingDate).getTime() < new Date(latestBookingDate).getTime()
            )
          ) {
            updates.consultationBookingDate = new Date(latestBookingDate);
          }
          if (
            latestCreatedAt &&
            (
              !directClient.consultationRecordCreatedAt ||
              new Date(directClient.consultationRecordCreatedAt).getTime() > new Date(latestCreatedAt).getTime()
            )
          ) {
            updates.consultationRecordCreatedAt = new Date(latestCreatedAt);
          }
          if (Object.keys(updates).length > 0) {
            const updateResult = await prisma.directClient.updateMany({
              where: { id: directClient.id },
              data: updates,
            });
            if (updateResult.count === 0) {
              throw new Error('Не вдалося self-heal consultation поля через updateMany');
            }
            console.log('[direct/record-history] ✅ Self-healed consultation fields from history', {
              altegioClientId,
              updates: {
                consultationBookingDate: latestBookingDate,
                consultationRecordCreatedAt: latestCreatedAt,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[direct/record-history] ⚠️ Не вдалося self-heal consultation поля з історії:', err);
      }
    }

    return NextResponse.json({
      ok: true,
      altegioClientId,
      type,
      total: rows.length,
      rows,
      selfHealedPaidAttendance,
      selfHealedConsultationAttendance,
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

