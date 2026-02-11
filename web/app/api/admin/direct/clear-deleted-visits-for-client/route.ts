// web/app/api/admin/direct/clear-deleted-visits-for-client/route.ts
// Для одного клієнта перевіряє візити в Altegio (GET /visits) та очищає консультацію/платний запис, якщо візиту немає (404).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientRecords, isConsultationService } from '@/lib/altegio/records';
import { getVisitWithRecords } from '@/lib/altegio/visits';
import type { DirectClient } from '@/lib/direct-types';
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

/**
 * POST — перевірити візити клієнта в Altegio та очистити поля, якщо візиту немає (404).
 * Body: { altegioClientId: number }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const altegioClientIdParam = body.altegioClientId;

    if (altegioClientIdParam == null || altegioClientIdParam === '') {
      return NextResponse.json(
        { ok: false, error: 'Вкажіть altegioClientId (ID клієнта в Altegio)' },
        { status: 400 }
      );
    }

    const companyId = parseInt(String(process.env.ALTEGIO_COMPANY_ID || ''), 10);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return NextResponse.json({
        ok: false,
        error: 'ALTEGIO_COMPANY_ID не встановлено або невалідний',
      }, { status: 400 });
    }

    const altegioId = parseInt(String(altegioClientIdParam), 10);
    if (!Number.isFinite(altegioId)) {
      return NextResponse.json({ ok: false, error: 'altegioClientId має бути числом' }, { status: 400 });
    }

    const client = await prisma.directClient.findFirst({
      where: { altegioClientId: altegioId },
    });

    if (!client) {
      return NextResponse.json({ ok: false, error: 'Клієнта не знайдено' }, { status: 404 });
    }

    if (!client.altegioClientId) {
      return NextResponse.json({
        ok: false,
        error: 'У клієнта немає altegioClientId',
      }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    let clearedConsultation = false;
    let clearedPaid = false;

    // 1) Збережений paidServiceVisitId: якщо 404 — очищаємо платний блок
    const storedPaidVisitId = client.paidServiceVisitId ?? null;
    if (
      (client.paidServiceDate != null || client.signedUpForPaidService) &&
      storedPaidVisitId != null &&
      Number.isFinite(Number(storedPaidVisitId))
    ) {
      const storedVisitData = await getVisitWithRecords(Number(storedPaidVisitId), companyId);
      if (storedVisitData === null) {
        updates.paidServiceDate = null;
        updates.paidServiceAttended = null;
        updates.signedUpForPaidService = false;
        updates.paidServiceVisitId = null;
        updates.paidServiceRecordId = null;
        updates.paidServiceVisitBreakdown = null;
        updates.paidServiceTotalCost = null;
        clearedPaid = true;
      }
    }

    // 2) GET /records → перевірка visit_id для останньої консультації та платного запису
    const records = await getClientRecords(companyId, client.altegioClientId);
    const consultationRecords = records.filter(
      (r) => !r.deleted && r.services?.length && isConsultationService(r.services).isConsultation
    );
    const paidRecords = records.filter(
      (r) => !r.deleted && r.services?.length && !isConsultationService(r.services).isConsultation
    );

    const visitDataCache = new Map<number, Awaited<ReturnType<typeof getVisitWithRecords>>>();
    const uniqueVisitIds = new Set<number>();
    for (const r of consultationRecords) {
      if (r.visit_id != null && Number.isFinite(r.visit_id)) uniqueVisitIds.add(r.visit_id);
    }
    for (const r of paidRecords) {
      if (r.visit_id != null && Number.isFinite(r.visit_id)) uniqueVisitIds.add(r.visit_id);
    }
    for (const vid of uniqueVisitIds) {
      const data = await getVisitWithRecords(vid, companyId);
      visitDataCache.set(vid, data);
    }

    const consultationRecordsFiltered = consultationRecords.filter(
      (r) => r.visit_id == null || visitDataCache.get(r.visit_id) !== null
    );
    const paidRecordsFiltered = paidRecords.filter(
      (r) => r.visit_id == null || visitDataCache.get(r.visit_id) !== null
    );

    const latestConsultation =
      consultationRecordsFiltered.length > 0
        ? consultationRecordsFiltered.reduce((best, r) => {
            const d = r.date ? new Date(r.date).getTime() : 0;
            const bestD = best.date ? new Date(best.date).getTime() : 0;
            return d > bestD ? r : best;
          }, consultationRecordsFiltered[0])
        : null;
    const latestPaid =
      paidRecordsFiltered.length > 0
        ? paidRecordsFiltered.reduce((best, r) => {
            const d = r.date ? new Date(r.date).getTime() : 0;
            const bestD = best.date ? new Date(best.date).getTime() : 0;
            return d > bestD ? r : best;
          }, paidRecordsFiltered[0])
        : null;

    const consultationVisitId = latestConsultation?.visit_id ?? null;
    const paidVisitId = latestPaid?.visit_id ?? null;
    const consultVisitData = consultationVisitId != null ? (visitDataCache.get(consultationVisitId) ?? null) : null;
    const paidVisitData =
      paidVisitId != null
        ? paidVisitId === consultationVisitId
          ? consultVisitData
          : (visitDataCache.get(paidVisitId) ?? null)
        : null;

    if (latestConsultation?.visit_id && consultVisitData === null) {
      if (client.consultationBookingDate != null || client.consultationAttended != null) {
        updates.consultationBookingDate = null;
        updates.consultationAttended = null;
        updates.consultationMasterName = null;
        updates.consultationMasterId = null;
        updates.isOnlineConsultation = false;
        updates.consultationCancelled = false;
        clearedConsultation = true;
      }
    }

    if (latestPaid?.visit_id && paidVisitData === null && !clearedPaid) {
      if (client.paidServiceDate != null || client.paidServiceAttended != null) {
        updates.paidServiceDate = null;
        updates.paidServiceAttended = null;
        updates.signedUpForPaidService = false;
        updates.paidServiceVisitId = null;
        updates.paidServiceRecordId = null;
        updates.paidServiceVisitBreakdown = null;
        updates.paidServiceTotalCost = null;
        clearedPaid = true;
      }
    }

    if (!latestConsultation && (client.consultationBookingDate != null || client.consultationAttended != null)) {
      updates.consultationBookingDate = null;
      updates.consultationAttended = null;
      updates.consultationMasterName = null;
      updates.consultationMasterId = null;
      updates.isOnlineConsultation = false;
      updates.consultationCancelled = false;
      clearedConsultation = true;
    }

    if (!latestPaid && (client.paidServiceDate != null || client.paidServiceAttended != null) && !clearedPaid) {
      updates.paidServiceDate = null;
      updates.paidServiceAttended = null;
      updates.signedUpForPaidService = false;
      updates.paidServiceVisitId = null;
      updates.paidServiceRecordId = null;
      updates.paidServiceVisitBreakdown = null;
      updates.paidServiceTotalCost = null;
      clearedPaid = true;
    }

    const changed = clearedConsultation || clearedPaid;
    let afterUpdate: { consultationBookingDate: Date | null; consultationMasterName: string | null; paidServiceDate: Date | null } | null = null;
    let duplicatesUpdated = 0;

    if (changed) {
      // Примусовий prisma.update, щоб гарантовано зберегти null
      const forceData: Record<string, unknown> = {};
      if (clearedConsultation) {
        forceData.consultationBookingDate = null;
        forceData.consultationAttended = null;
        forceData.consultationMasterName = null;
        forceData.consultationMasterId = null;
        forceData.isOnlineConsultation = false;
        forceData.consultationCancelled = false;
      }
      if (clearedPaid) {
        forceData.paidServiceDate = null;
        forceData.paidServiceAttended = null;
        forceData.signedUpForPaidService = false;
        forceData.paidServiceVisitId = null;
        forceData.paidServiceRecordId = null;
        forceData.paidServiceVisitBreakdown = null;
        forceData.paidServiceTotalCost = null;
      }
      if (Object.keys(forceData).length > 0) {
        const data = forceData as Parameters<typeof prisma.directClient.update>[0]['data'];
        await prisma.directClient.update({
          where: { id: client.id },
          data,
        });
        // Оновлюємо всі записи з тим самим instagramUsername (дублікати), щоб у таблиці зникли дані в усіх рядках
        const sameUsername = (client.instagramUsername ?? '').toString().trim();
        if (sameUsername) {
          const others = await prisma.directClient.findMany({
            where: {
              id: { not: client.id },
              instagramUsername: { equals: sameUsername, mode: 'insensitive' },
            },
            select: { id: true },
          });
          duplicatesUpdated = others.length;
          for (const other of others) {
            await prisma.directClient.update({ where: { id: other.id }, data });
          }
        }
        const row = await prisma.directClient.findUnique({
          where: { id: client.id },
          select: {
            consultationBookingDate: true,
            consultationMasterName: true,
            paidServiceDate: true,
          },
        });
        if (row) {
          afterUpdate = {
            consultationBookingDate: row.consultationBookingDate,
            consultationMasterName: row.consultationMasterName,
            paidServiceDate: row.paidServiceDate,
          };
        }
      }
      // Лог у store без перезапису полів (оновлюємо тільки updatedAt для консистентності)
      const full = await prisma.directClient.findUnique({ where: { id: client.id } });
      if (full) {
        const updated = { ...full, ...updates } as typeof full;
        await saveDirectClient(updated as unknown as DirectClient, 'clear-deleted-visits-for-client', {
          altegioClientId: client.altegioClientId,
          source: 'GET /visits перевірка для одного клієнта',
        }, { touchUpdatedAt: false });
      }
    }

    const parts: string[] = [];
    if (clearedConsultation) parts.push('консультацію');
    if (clearedPaid) parts.push('платний запис');
    const message =
      parts.length > 0
        ? `Очищено: ${parts.join(', ')} (візиту немає в Altegio).`
        : changed
          ? 'Оновлено інші поля.'
          : 'Нічого не змінено — візити існують у Altegio або записів немає.';

    return NextResponse.json({
      ok: true,
      clientId: client.id,
      altegioClientId: client.altegioClientId ?? null,
      instagramUsername: client.instagramUsername ?? null,
      clearedConsultation,
      clearedPaid,
      duplicatesUpdated,
      message,
      afterUpdate: afterUpdate ?? undefined,
    });
  } catch (error) {
    console.error('[clear-deleted-visits-for-client] Error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
