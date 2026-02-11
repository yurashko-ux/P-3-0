// web/app/api/admin/direct/sync-visit-history-from-api/route.ts
// Завантаження історії візитів (консультації + записи) з Altegio API та оновлення статусів (consultationAttended, paidServiceAttended).
// Список записів: GET /records. Статус візиту: GET /visits/{visit_id}. При 404 (візит не існує в Altegio) — очищаємо відповідні поля.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientRecords, isConsultationService } from '@/lib/altegio/records';
import { getVisitWithRecords } from '@/lib/altegio/visits';
import { saveDirectClient } from '@/lib/direct-store';

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

function toISO8601(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d/.test(s)
    ? s.replace(/(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    : s;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** 1 або 2 = прийшов (Altegio). */
function isArrived(attendance: number | null): boolean {
  return attendance === 1 || attendance === 2;
}

/** Нормалізує дату з БД (Date або string) до ISO рядка для порівняння. */
function toISOStringOrNull(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

/** Витягує attendance з об'єкта візиту GET /visits (data.attendance або data.records[0]). */
function attendanceFromVisit(visit: unknown): number | null {
  if (!visit || typeof visit !== 'object') return null;
  const v = visit as Record<string, unknown>;
  const att = v.attendance ?? v.visit_attendance ?? (Array.isArray(v.records) && v.records[0] && typeof v.records[0] === 'object'
    ? ((v.records[0] as Record<string, unknown>).attendance ?? (v.records[0] as Record<string, unknown>).visit_attendance)
    : undefined);
  if (att === 1 || att === 0 || att === -1 || att === 2) return Number(att);
  return null;
}

/**
 * POST — завантажити історію візитів з Altegio API для всіх клієнтів та оновити статуси.
 * Query: delayMs=250 (затримка між клієнтами).
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const delayMs = Math.min(2000, Math.max(100, parseInt(req.nextUrl.searchParams.get('delayMs') || '250', 10) || 250));

  try {
    const companyId = parseInt(String(process.env.ALTEGIO_COMPANY_ID || ''), 10);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return NextResponse.json({
        ok: false,
        error: 'ALTEGIO_COMPANY_ID не встановлено або невалідний',
      }, { status: 400 });
    }

    const clients = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        altegioClientId: true,
        consultationBookingDate: true,
        consultationAttended: true,
        isOnlineConsultation: true,
        paidServiceDate: true,
        paidServiceAttended: true,
        signedUpForPaidService: true,
      },
    });

    const stats = {
      total: clients.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      consultationUpdated: 0,
      paidUpdated: 0,
      consultationCleared: 0,
      paidCleared: 0,
      ms: 0,
    };

    const start = Date.now();

    for (const client of clients) {
      try {
        if (!client.altegioClientId) {
          stats.skipped++;
          continue;
        }

        const records = await getClientRecords(companyId, client.altegioClientId);
        await new Promise((r) => setTimeout(r, delayMs));

        const consultationRecords = records.filter(
          (r) => !r.deleted && r.services?.length && isConsultationService(r.services).isConsultation
        );
        const paidRecords = records.filter(
          (r) => !r.deleted && r.services?.length && !isConsultationService(r.services).isConsultation
        );

        // Найновіша консультація за датою візиту
        let latestConsultation: typeof records[0] | null = null;
        if (consultationRecords.length > 0) {
          latestConsultation = consultationRecords.reduce((best, r) => {
            const d = r.date ? new Date(r.date).getTime() : 0;
            const bestD = best.date ? new Date(best.date).getTime() : 0;
            return d > bestD ? r : best;
          }, consultationRecords[0]);
        }

        // Найновіший платний запис
        let latestPaid: typeof records[0] | null = null;
        if (paidRecords.length > 0) {
          latestPaid = paidRecords.reduce((best, r) => {
            const d = r.date ? new Date(r.date).getTime() : 0;
            const bestD = best.date ? new Date(best.date).getTime() : 0;
            return d > bestD ? r : best;
          }, paidRecords[0]);
        }

        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        let changed = false;

        // Звірка через GET /visits/{visit_id}: при 404 (візит не існує в Altegio) очищаємо відповідний блок
        const consultationVisitId = latestConsultation?.visit_id ?? null;
        const paidVisitId = latestPaid?.visit_id ?? null;
        let consultVisitData: Awaited<ReturnType<typeof getVisitWithRecords>> = null;
        if (consultationVisitId) {
          consultVisitData = await getVisitWithRecords(consultationVisitId, companyId);
          await new Promise((r) => setTimeout(r, delayMs));
        }
        let paidVisitData: Awaited<ReturnType<typeof getVisitWithRecords>> = null;
        if (paidVisitId && paidVisitId !== consultationVisitId) {
          paidVisitData = await getVisitWithRecords(paidVisitId, companyId);
          await new Promise((r) => setTimeout(r, delayMs));
        } else if (paidVisitId === consultationVisitId) {
          paidVisitData = consultVisitData;
        }

        // Консультація: дата з GET /records, статус та існування — з GET /visits/{visit_id}
        if (latestConsultation?.visit_id && consultVisitData === null) {
          if (client.consultationBookingDate != null || client.consultationAttended != null) {
            updates.consultationBookingDate = null;
            updates.consultationAttended = null;
            changed = true;
            stats.consultationCleared++;
          }
        } else if (latestConsultation?.date && consultVisitData) {
          const isoDate = toISO8601(latestConsultation.date);
          if (isoDate) {
            const attendanceConsult = attendanceFromVisit(consultVisitData) ?? latestConsultation.attendance ?? null;
            const newAttended = isArrived(attendanceConsult);
            if (
              toISOStringOrNull(client.consultationBookingDate) !== isoDate ||
              client.consultationAttended !== newAttended
            ) {
              updates.consultationBookingDate = isoDate;
              updates.consultationAttended = newAttended;
              updates.isOnlineConsultation = isConsultationService(latestConsultation.services).isOnline;
              changed = true;
              stats.consultationUpdated++;
            }
          }
        } else if (latestConsultation?.date && !consultationVisitId) {
          // Запис є в GET /records, але без visit_id — оновлюємо з record.attendance
          const isoDate = toISO8601(latestConsultation.date);
          if (isoDate) {
            const newAttended = isArrived(latestConsultation.attendance ?? null);
            if (
              toISOStringOrNull(client.consultationBookingDate) !== isoDate ||
              client.consultationAttended !== newAttended
            ) {
              updates.consultationBookingDate = isoDate;
              updates.consultationAttended = newAttended;
              updates.isOnlineConsultation = isConsultationService(latestConsultation.services).isOnline;
              changed = true;
              stats.consultationUpdated++;
            }
          }
        } else if (!latestConsultation) {
          if (client.consultationBookingDate != null || client.consultationAttended != null) {
            updates.consultationBookingDate = null;
            updates.consultationAttended = null;
            changed = true;
            stats.consultationCleared++;
          }
        }

        // Платний запис: дата з GET /records, статус та існування — з GET /visits/{visit_id}
        if (latestPaid?.visit_id && paidVisitData === null) {
          if (client.paidServiceDate != null || client.paidServiceAttended != null) {
            updates.paidServiceDate = null;
            updates.paidServiceAttended = null;
            updates.signedUpForPaidService = false;
            changed = true;
            stats.paidCleared++;
          }
        } else if (latestPaid?.date && paidVisitData) {
          const isoDate = toISO8601(latestPaid.date);
          if (isoDate) {
            const attendancePaid = attendanceFromVisit(paidVisitData) ?? latestPaid.attendance ?? null;
            const newAttended = isArrived(attendancePaid);
            if (
              toISOStringOrNull(client.paidServiceDate) !== isoDate ||
              client.paidServiceAttended !== newAttended
            ) {
              updates.paidServiceDate = isoDate;
              updates.paidServiceAttended = newAttended;
              updates.signedUpForPaidService = true;
              changed = true;
              stats.paidUpdated++;
            }
          }
        } else if (latestPaid?.date && !paidVisitId) {
          const isoDate = toISO8601(latestPaid.date);
          if (isoDate) {
            const newAttended = isArrived(latestPaid.attendance ?? null);
            if (
              toISOStringOrNull(client.paidServiceDate) !== isoDate ||
              client.paidServiceAttended !== newAttended
            ) {
              updates.paidServiceDate = isoDate;
              updates.paidServiceAttended = newAttended;
              updates.signedUpForPaidService = true;
              changed = true;
              stats.paidUpdated++;
            }
          }
        } else if (!latestPaid) {
          if (client.paidServiceDate != null || client.paidServiceAttended != null) {
            updates.paidServiceDate = null;
            updates.paidServiceAttended = null;
            updates.signedUpForPaidService = false;
            changed = true;
            stats.paidCleared++;
          }
        }

        if (changed) {
          const full = await prisma.directClient.findUnique({ where: { id: client.id } });
          if (full) {
            const updated = { ...full, ...updates } as typeof full;
            await saveDirectClient(updated, 'sync-visit-history-from-api', {
              altegioClientId: client.altegioClientId,
              source: 'Altegio GET /records + GET /visits/{visit_id}',
            }, { touchUpdatedAt: false });
            stats.updated++;
          }
        } else {
          stats.skipped++;
        }
      } catch (err) {
        stats.errors++;
        console.error(`[sync-visit-history-from-api] Client ${client.id} (${client.altegioClientId}):`, err);
      }
    }

    stats.ms = Date.now() - start;
    console.log(`[sync-visit-history-from-api] Done: updated=${stats.updated}, skipped=${stats.skipped}, errors=${stats.errors}, ms=${stats.ms}`);

    return NextResponse.json({
      ok: true,
      message: `Оновлено ${stats.updated} клієнтів (консультації: ${stats.consultationUpdated}, записи: ${stats.paidUpdated}; очищено консультацій: ${stats.consultationCleared}, записів: ${stats.paidCleared}). Пропущено: ${stats.skipped}, помилок: ${stats.errors}.`,
      stats,
    });
  } catch (error) {
    console.error('[sync-visit-history-from-api] Error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
