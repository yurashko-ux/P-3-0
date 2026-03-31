// web/app/api/admin/direct/sync-consultation-booking-dates/route.ts
// Endpoint для синхронізації consultationBookingDate з Altegio GET /records API та fallback на KV

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getClientRecords, isConsultationService as isConsultationFromServices } from '@/lib/altegio/records';
import { kvRead, kvWrite } from '@/lib/kv';
import { normalizeRecordsLogItems, groupRecordsByClientDay, pickRecordCreatedAtISOFromGroup } from '@/lib/altegio/records-grouping';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const DEFAULT_BATCH_CURSOR_KEY = 'direct:sync:consultation-booking-dates:offset';

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
    const maxRunMsParam = parseInt(req.nextUrl.searchParams.get('maxRunMs') || '20000', 10);
    const maxRunMs = Number.isFinite(maxRunMsParam) ? Math.min(60000, Math.max(5000, maxRunMsParam)) : 20000;
    const apiTimeoutMs = includeComplete ? 5000 : 2500;
    const startedAt = Date.now();
    let stoppedEarly = false;
    
    // За замовчуванням обробляємо лише тих, у кого немає consultationBookingDate
    // і хто ще не виглядає repeat-клієнтом без збереженої консультації.
    // Це вирівнює кнопку #13 з логікою record-history, де такі кейси ігноруються.
    const baseWhere = {
      altegioClientId: {
        not: null,
      },
      ...(includeComplete
        ? {}
        : {
            consultationBookingDate: null,
            OR: [
              { visits: null },
              { visits: { lt: 2 } },
            ],
          }),
    } as const;

    const totalCandidates = await prisma.directClient.count({
      where: baseWhere,
    });
    let batchOffset = 0;
    if (!includeComplete && totalCandidates > 0) {
      try {
        const rawOffset = await kvRead.getRaw(DEFAULT_BATCH_CURSOR_KEY);
        const parsedOffset = parseInt(String(rawOffset || '0'), 10);
        if (Number.isFinite(parsedOffset) && parsedOffset > 0) {
          batchOffset = Math.min(parsedOffset, Math.max(0, totalCandidates - 1));
        }
      } catch (cursorErr) {
        console.warn('[sync-consultation-booking-dates] Не вдалося прочитати cursor батчу з KV:', cursorErr);
      }
    }

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

    const candidateClients = await prisma.directClient.findMany({
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
      take: includeComplete ? take : Math.min(Math.max(totalCandidates, take), 1000),
    });

    const prioritizedCandidates = includeComplete
      ? candidateClients
      : candidateClients.sort((a, b) => {
          const aHasKv = a.altegioClientId ? consultationFromKvByClient.has(Number(a.altegioClientId)) : false;
          const bHasKv = b.altegioClientId ? consultationFromKvByClient.has(Number(b.altegioClientId)) : false;
          if (aHasKv !== bHasKv) return aHasKv ? -1 : 1;
          return String(a.id).localeCompare(String(b.id));
        });

    const normalizedOffset =
      !includeComplete && prioritizedCandidates.length > 0
        ? Math.min(batchOffset, Math.max(0, prioritizedCandidates.length - 1))
        : 0;

    let allClients = includeComplete
      ? prioritizedCandidates
      : prioritizedCandidates.slice(normalizedOffset, normalizedOffset + take);

    if (!includeComplete && allClients.length === 0 && prioritizedCandidates.length > 0) {
      batchOffset = 0;
      allClients = prioritizedCandidates.slice(0, take);
    } else if (!includeComplete) {
      batchOffset = normalizedOffset;
    }

    console.log(
      `[sync-consultation-booking-dates] Found ${totalCandidates} candidate clients, processing batch ${allClients.length} (limit=${take}, all=${includeComplete}, kvPriority=${!includeComplete}, offset=${batchOffset})`
    );
    
    const results = {
      total: totalCandidates,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      remainingCount: Math.max(0, totalCandidates - allClients.length),
      mode: includeComplete ? 'all' : 'booking_missing_only',
      batchOffset,
      stoppedEarly: false,
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
      if (Date.now() - startedAt >= maxRunMs) {
        stoppedEarly = true;
        console.warn('[sync-consultation-booking-dates] ⏱️ Зупиняємо батч по time budget', {
          maxRunMs,
          processed: results.processed,
          updated: results.updated,
          skipped: results.skipped,
          errors: results.errors,
        });
        break;
      }
      try {
        results.processed++;
        if (!client.altegioClientId) {
          results.skipped++;
          continue;
        }
        
        let latestConsultationDate: string | null = null;
        let isOnlineConsultation: boolean | null = null;
        let consultationRecordCreatedAt: string | null = null;
        let source: 'api' | 'kv' = 'api';
        let apiErrorMessage: string | null = null;
        const kvConsult = consultationFromKvByClient.get(Number(client.altegioClientId));

        // Для кнопки #13 спочатку беремо KV, щоб масовий sync повертався швидко.
        if (!includeComplete && kvConsult) {
          latestConsultationDate = kvConsult.datetime;
          isOnlineConsultation = kvConsult.isOnline;
          consultationRecordCreatedAt = kvConsult.createdAt;
          source = 'kv';
        }
        
        if (useApi && !latestConsultationDate) {
          try {
            const records = await getClientRecords(companyId, client.altegioClientId, {
              retries: 0,
              timeoutMs: apiTimeoutMs,
            });
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
          } catch (err) {
            apiErrorMessage = err instanceof Error ? err.message : String(err);
            console.warn('[sync-consultation-booking-dates] ⚠️ API records error, fallback to KV', {
              clientId: client.id,
              altegioClientId: client.altegioClientId,
              error: apiErrorMessage,
            });
          }
          if (API_DELAY_MS > 0) {
            await new Promise((r) => setTimeout(r, API_DELAY_MS));
          }
        }

        // Fallback на KV, якщо API не повернув консультацію
        if (!latestConsultationDate) {
          if (kvConsult) {
            latestConsultationDate = kvConsult.datetime;
            isOnlineConsultation = kvConsult.isOnline;
            consultationRecordCreatedAt = kvConsult.createdAt;
            source = 'kv';
          }
        }
        
        if (!latestConsultationDate) {
          if (apiErrorMessage) {
            results.errors++;
            results.details.push({
              clientId: client.id,
              instagramUsername: client.instagramUsername,
              altegioClientId: client.altegioClientId,
              oldConsultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate).toISOString() : null,
              newConsultationBookingDate: null,
              oldConsultationRecordCreatedAt: client.consultationRecordCreatedAt ? new Date(client.consultationRecordCreatedAt).toISOString() : null,
              newConsultationRecordCreatedAt: null,
              reason: `API error без KV fallback: ${apiErrorMessage}`,
            });
          } else {
            results.skipped++;
          }
          continue;
        }

        const isoConsultationDate = toISO8601(latestConsultationDate);
        if (!isoConsultationDate) {
          results.errors++;
          console.error(`[sync-consultation-booking-dates] Невалідна дата для клієнта ${client.id}: ${latestConsultationDate}`);
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            oldConsultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate).toISOString() : null,
            newConsultationBookingDate: null,
            oldConsultationRecordCreatedAt: client.consultationRecordCreatedAt ? new Date(client.consultationRecordCreatedAt).toISOString() : null,
            newConsultationRecordCreatedAt: consultationRecordCreatedAt,
            reason: `Невалідна дата consultation: ${latestConsultationDate}`,
          });
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
          const updateResult = await prisma.directClient.updateMany({
            where: { id: client.id },
            data: {
              ...(shouldUpdateBookingDate && { consultationBookingDate: isoConsultationDate }),
              ...(shouldUpdateCreatedAt && consultationRecordCreatedAt && { consultationRecordCreatedAt }),
              ...(isOnlineConsultation !== null && { isOnlineConsultation }),
            },
          });
          if (updateResult.count === 0) {
            throw new Error('Не вдалося оновити directClient через updateMany');
          }
          
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
        results.details.push({
          clientId: client.id,
          instagramUsername: client.instagramUsername,
          altegioClientId: client.altegioClientId,
          oldConsultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate).toISOString() : null,
          newConsultationBookingDate: null,
          oldConsultationRecordCreatedAt: client.consultationRecordCreatedAt ? new Date(client.consultationRecordCreatedAt).toISOString() : null,
          newConsultationRecordCreatedAt: null,
          reason: `Помилка обробки: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    results.stoppedEarly = stoppedEarly;
    results.remainingCount = Math.max(0, totalCandidates - results.processed);
    if (!includeComplete) {
      try {
        const processedWindow = Math.min(allClients.length, Math.max(1, results.processed));
        const nextOffset =
          prioritizedCandidates.length > 0
            ? (batchOffset + processedWindow) % prioritizedCandidates.length
            : 0;
        await kvWrite.setRaw(DEFAULT_BATCH_CURSOR_KEY, String(nextOffset));
        (results as typeof results & { nextBatchOffset?: number }).nextBatchOffset = nextOffset;
      } catch (cursorErr) {
        console.warn('[sync-consultation-booking-dates] Не вдалося зберегти cursor батчу в KV:', cursorErr);
      }
    }
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      ok: true,
      message: includeComplete
        ? `Оброблено батч ${results.processed}/${results.total}. Оновлено ${results.updated}, пропущено ${results.skipped}, помилок ${results.errors}.${results.stoppedEarly ? ' Зупинено по time budget, можна запускати наступний батч.' : ''}`
        : `Оброблено батч клієнтів без consultationBookingDate: ${results.processed}/${results.total}. Оновлено ${results.updated}, пропущено ${results.skipped}, помилок ${results.errors}.${results.stoppedEarly ? ' Зупинено по time budget, можна запускати наступний батч.' : ''}`,
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
