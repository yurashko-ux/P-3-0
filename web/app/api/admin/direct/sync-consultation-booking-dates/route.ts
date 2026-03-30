// web/app/api/admin/direct/sync-consultation-booking-dates/route.ts
// Endpoint для синхронізації consultationBookingDate з Altegio GET /records API та fallback на KV

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getClientRecords, isConsultationService as isConsultationFromServices } from '@/lib/altegio/records';
import { kvRead } from '@/lib/kv';
import { normalizeRecordsLogItems, groupRecordsByClientDay, pickRecordCreatedAtISOFromGroup } from '@/lib/altegio/records-grouping';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

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
 * Нормалізує дату до ISO-8601 для Prisma (Altegio API повертає "YYYY-MM-DD HH:mm:ss").
 */
function toISO8601(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;
  // Нормалізуємо "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss" для парсингу
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d/.test(s)
    ? s.replace(/(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    : s;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * POST - синхронізувати consultationBookingDate з Altegio API (GET /records) для консультацій
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = new PrismaClient();
    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '80', 10);
    const take = Number.isFinite(limitParam) ? Math.min(200, Math.max(1, limitParam)) : 80;
    const includeComplete = req.nextUrl.searchParams.get('all') === '1';
    
    // За замовчуванням обробляємо лише тих, у кого бракує consultation-полів,
    // щоб кнопка не зависала на всій базі за один запуск.
    const baseWhere = {
      altegioClientId: {
        not: null,
      },
      ...(includeComplete
        ? {}
        : {
            OR: [
              { consultationBookingDate: null },
              { consultationRecordCreatedAt: null },
            ],
          }),
    } as const;

    const totalCandidates = await prisma.directClient.count({
      where: baseWhere,
    });

    // Отримуємо батч клієнтів з Altegio ID
    const allClients = await prisma.directClient.findMany({
      where: baseWhere,
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        altegioClientId: true,
        consultationBookingDate: true,
        consultationRecordCreatedAt: true,
      },
      orderBy: [
        { consultationBookingDate: 'asc' },
        { consultationRecordCreatedAt: 'asc' },
        { updatedAt: 'desc' },
      ],
      take,
    });
    
    console.log(
      `[sync-consultation-booking-dates] Found ${totalCandidates} candidate clients, processing batch ${allClients.length} (limit=${take}, all=${includeComplete})`
    );
    
    const companyId = parseInt(String(process.env.ALTEGIO_COMPANY_ID || ''), 10);
    const useApi = Number.isFinite(companyId) && companyId > 0;
    if (!useApi) {
      console.log('[sync-consultation-booking-dates] ALTEGIO_COMPANY_ID not set or invalid, no API calls');
    }
    
    /** Затримка між викликами API (rate limit Altegio). */
    const API_DELAY_MS = 250;

    // Fallback на KV: якщо API не повертає консультацію, беремо з records:log
    const consultationFromKvByClient = new Map<number, { datetime: string; isOnline: boolean; createdAt: string | null }>();
    try {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      const groupsByClient = groupRecordsByClientDay(normalizedEvents);
      for (const [clientId, groups] of groupsByClient.entries()) {
        const consultationGroups = groups.filter((g) => g.groupType === 'consultation');
        if (consultationGroups.length === 0) continue;
        const latest = consultationGroups.sort((a, b) => {
          const ta = new Date(a.datetime || a.receivedAt || 0).getTime();
          const tb = new Date(b.datetime || b.receivedAt || 0).getTime();
          return tb - ta;
        })[0];
        const datetime = latest.datetime || latest.receivedAt;
        if (datetime) {
          consultationFromKvByClient.set(clientId, {
            datetime,
            isOnline: latest.services?.some((s: any) => /онлайн/i.test(s?.title || s?.name || '')) ?? false,
            createdAt: pickRecordCreatedAtISOFromGroup(latest) ?? null,
          });
        }
      }
      console.log(`[sync-consultation-booking-dates] KV fallback: ${consultationFromKvByClient.size} клієнтів з консультаціями`);
    } catch (kvErr) {
      console.warn('[sync-consultation-booking-dates] KV fallback failed:', kvErr);
    }
    
    const results = {
      total: totalCandidates,
      processed: allClients.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      remainingCount: Math.max(0, totalCandidates - allClients.length),
      mode: includeComplete ? 'all' : 'missing_only',
      details: [] as Array<{
        clientId: string;
        instagramUsername: string | null;
        altegioClientId: number | null;
        oldConsultationBookingDate: string | null;
        newConsultationBookingDate: string;
        oldConsultationRecordCreatedAt: string | null;
        newConsultationRecordCreatedAt: string | null;
        reason: string;
      }>,
    };
    
    // Оновлюємо клієнтів тільки з даних API (GET /records)
    for (const client of allClients) {
      try {
        if (!client.altegioClientId) {
          results.skipped++;
          continue;
        }
        
        let latestConsultationDate: string | null = null;
        let isOnlineConsultation: boolean | null = null;
        let consultationRecordCreatedAt: string | null = null;
        let source: 'api' | 'kv' = 'api';
        
        if (useApi) {
          const records = await getClientRecords(companyId, client.altegioClientId);
          const consultationRecords = records.filter((r) => r.services?.length && isConsultationFromServices(r.services).isConsultation);
          if (consultationRecords.length > 0) {
            let best = consultationRecords[0];
            for (const r of consultationRecords) {
              const d = r.date ? new Date(r.date).getTime() : 0;
              const bestD = best.date ? new Date(best.date).getTime() : 0;
              if (d > bestD) best = r;
            }
            if (best.date) {
              latestConsultationDate = best.date;
              isOnlineConsultation = isConsultationFromServices(best.services).isOnline;
              consultationRecordCreatedAt = toISO8601(best.create_date);
            }
          }
          await new Promise((r) => setTimeout(r, API_DELAY_MS));
        }

        // Fallback на KV, якщо API не повернув консультацію
        if (!latestConsultationDate) {
          const kvConsult = consultationFromKvByClient.get(Number(client.altegioClientId));
          if (kvConsult) {
            latestConsultationDate = kvConsult.datetime;
            isOnlineConsultation = kvConsult.isOnline;
            consultationRecordCreatedAt = kvConsult.createdAt;
            source = 'kv';
          }
        }
        
        if (!latestConsultationDate) {
          results.skipped++;
          continue;
        }

        const isoConsultationDate = toISO8601(latestConsultationDate);
        if (!isoConsultationDate) {
          results.errors++;
          console.error(`[sync-consultation-booking-dates] Невалідна дата для клієнта ${client.id}: ${latestConsultationDate}`);
          continue;
        }
        
        // Перевіряємо, чи потрібно оновити
        const shouldUpdateBookingDate =
          !client.consultationBookingDate ||
          new Date(client.consultationBookingDate) < new Date(isoConsultationDate);
        const shouldUpdateCreatedAt =
          Boolean(consultationRecordCreatedAt) &&
          (
            !client.consultationRecordCreatedAt ||
            new Date(client.consultationRecordCreatedAt) > new Date(consultationRecordCreatedAt as string)
          );
        
        if (shouldUpdateBookingDate || shouldUpdateCreatedAt) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              ...(shouldUpdateBookingDate && { consultationBookingDate: isoConsultationDate }),
              ...(shouldUpdateCreatedAt && consultationRecordCreatedAt && { consultationRecordCreatedAt }),
              ...(isOnlineConsultation !== null && { isOnlineConsultation }),
            },
          });
          
          results.updated++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            oldConsultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate).toISOString() : null,
            newConsultationBookingDate: isoConsultationDate,
            oldConsultationRecordCreatedAt: client.consultationRecordCreatedAt ? new Date(client.consultationRecordCreatedAt).toISOString() : null,
            newConsultationRecordCreatedAt: consultationRecordCreatedAt,
            reason: shouldUpdateBookingDate
              ? (client.consultationBookingDate ? 'Updated to newer date' : `Set from ${source}`)
              : `Filled consultationRecordCreatedAt from ${source}`,
          });
          
          console.log(
            `[sync-consultation-booking-dates] ✅ Updated client ${client.id} (${client.instagramUsername || client.firstName}): ` +
            `booking=${client.consultationBookingDate || 'null'} -> ${shouldUpdateBookingDate ? isoConsultationDate : client.consultationBookingDate || 'null'}, ` +
            `created=${client.consultationRecordCreatedAt || 'null'} -> ${shouldUpdateCreatedAt ? consultationRecordCreatedAt : client.consultationRecordCreatedAt || 'null'} (${source})`
          );
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.errors++;
        console.error(`[sync-consultation-booking-dates] Error processing client ${client.id}:`, err);
      }
    }
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      ok: true,
      message: includeComplete
        ? `Оброблено батч ${results.processed}/${results.total}. Оновлено ${results.updated}, пропущено ${results.skipped}, помилок ${results.errors}.`
        : `Оброблено батч клієнтів з порожніми consultation-полями: ${results.processed}/${results.total}. Оновлено ${results.updated}, пропущено ${results.skipped}, помилок ${results.errors}.`,
      results,
    });
  } catch (error) {
    console.error('[sync-consultation-booking-dates] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
