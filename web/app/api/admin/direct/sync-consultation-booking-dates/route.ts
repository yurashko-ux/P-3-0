// web/app/api/admin/direct/sync-consultation-booking-dates/route.ts
// Endpoint для синхронізації consultationBookingDate: спочатку GET /records API, fallback на вебхуки (KV)

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { kvRead } from '@/lib/kv';
import { getClientRecords, isConsultationService as isConsultationFromServices } from '@/lib/altegio/records';

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
 * Перевіряє, чи це консультація
 */
function isConsultationService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) {
    return false;
  }
  
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    return /консультаці/i.test(title);
  });
}

/**
 * Нормалізує дату до ISO-8601 для Prisma (Altegio API повертає "YYYY-MM-DD HH:mm:ss").
 */
function toISO8601(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * POST - синхронізувати consultationBookingDate з вебхуків для консультацій
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = new PrismaClient();
    
    // Отримуємо всі записи з records:log та webhook:log
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    
    console.log(`[sync-consultation-booking-dates] Found ${rawItemsRecords.length} records in records:log and ${rawItemsWebhook.length} in webhook:log`);
    
    // Парсимо записи (обробляємо можливий формат { value: "..." } від Upstash)
    const parseRecord = (raw: any) => {
      try {
        let parsed: any;
        if (typeof raw === 'string') {
          parsed = JSON.parse(raw);
        } else {
          parsed = raw;
        }
        
        // Upstash може повертати елементи як { value: "..." }
        if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
          try {
            parsed = JSON.parse(parsed.value);
          } catch {
            return null;
          }
        }
        
        return parsed;
      } catch {
        return null;
      }
    };
    
    const records = [...rawItemsRecords, ...rawItemsWebhook]
      .map(parseRecord)
      .filter((r) => r && (r.clientId || r.data?.clientId || r.body?.data?.client?.id || r.body?.data?.clientId) && (r.datetime || r.data?.datetime || r.body?.data?.datetime));
    
    console.log(`[sync-consultation-booking-dates] Parsed ${records.length} valid records`);
    
    // Групуємо записи по клієнтам та датам (тільки консультації)
    const clientConsultationMap = new Map<number, Array<{
      datetime: string;
      services: any[];
      visitId: number | null;
      recordId: number | null;
    }>>();
    
    for (const record of records) {
      const clientId = record.clientId || record.data?.clientId || record.body?.data?.client?.id || record.body?.data?.clientId;
      if (!clientId) continue;
      
      const services = record.data?.services || record.services || record.body?.data?.services || [];
      if (!Array.isArray(services) || services.length === 0) continue;
      
      // Перевіряємо, чи це консультація
      if (!isConsultationService(services)) continue;
      
      const datetime = record.datetime || record.data?.datetime || record.body?.data?.datetime;
      if (!datetime) continue;
      
      if (!clientConsultationMap.has(clientId)) {
        clientConsultationMap.set(clientId, []);
      }
      
      clientConsultationMap.get(clientId)!.push({
        datetime,
        services,
        visitId: record.visitId || record.body?.resource_id || null,
        recordId: record.recordId || null,
      });
    }
    
    console.log(`[sync-consultation-booking-dates] Found ${clientConsultationMap.size} clients with consultations (from KV)`);
    
    // Отримуємо всіх клієнтів з Altegio ID
    const allClients = await prisma.directClient.findMany({
      where: {
        altegioClientId: {
          not: null,
        },
      },
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        altegioClientId: true,
        consultationBookingDate: true,
      },
    });
    
    console.log(`[sync-consultation-booking-dates] Found ${allClients.length} clients with altegioClientId`);
    
    const companyId = parseInt(String(process.env.ALTEGIO_COMPANY_ID || ''), 10);
    const useApi = Number.isFinite(companyId) && companyId > 0;
    if (!useApi) {
      console.log('[sync-consultation-booking-dates] ALTEGIO_COMPANY_ID not set or invalid, using only KV');
    }
    
    /** Затримка між викликами API (rate limit Altegio). */
    const API_DELAY_MS = 250;
    
    const results = {
      total: allClients.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      fromApi: 0,
      fromKv: 0,
      details: [] as Array<{
        clientId: string;
        instagramUsername: string | null;
        altegioClientId: number | null;
        oldConsultationBookingDate: string | null;
        newConsultationBookingDate: string;
        reason: string;
      }>,
    };
    
    // Оновлюємо клієнтів: спочатку пробуємо API, fallback на KV
    for (const client of allClients) {
      try {
        if (!client.altegioClientId) {
          results.skipped++;
          continue;
        }
        
        let latestConsultationDate: string | null = null;
        let isOnlineConsultation: boolean | null = null;
        let source: 'api' | 'kv' = 'kv';
        
        // 1) Джерело API: GET /records/{location_id}?client_id={id}
        if (useApi) {
          const records = await getClientRecords(companyId, client.altegioClientId);
          const consultationRecords = records.filter((r) => r.services?.length && isConsultationFromServices(r.services).isConsultation);
          if (consultationRecords.length > 0) {
            // Найновіша дата візиту (як у поточній логіці по KV)
            let best = consultationRecords[0];
            for (const r of consultationRecords) {
              const d = r.date ? new Date(r.date).getTime() : 0;
              const bestD = best.date ? new Date(best.date).getTime() : 0;
              if (d > bestD) best = r;
            }
            if (best.date) {
              latestConsultationDate = best.date;
              isOnlineConsultation = isConsultationFromServices(best.services).isOnline;
              source = 'api';
            }
          }
          await new Promise((r) => setTimeout(r, API_DELAY_MS));
        }
        
        // 2) Fallback на KV
        if (!latestConsultationDate) {
          const consultations = clientConsultationMap.get(client.altegioClientId) || [];
          if (consultations.length === 0) {
            results.skipped++;
            continue;
          }
          let latestConsultation: { datetime: string; services: any[] } | null = null;
          for (const consultation of consultations) {
            const consultationDate = new Date(consultation.datetime);
            if (!latestConsultation || new Date(latestConsultation.datetime) < consultationDate) {
              latestConsultationDate = consultation.datetime;
              latestConsultation = consultation;
            }
          }
          if (latestConsultation) {
            isOnlineConsultation = latestConsultation.services.some((s: any) => {
              const title = (s.title || s.name || '').toLowerCase();
              return /онлайн/i.test(title) || /online/i.test(title);
            });
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
        
        if (source === 'api') results.fromApi++;
        else results.fromKv++;
        
        // Перевіряємо, чи потрібно оновити
        const shouldUpdate = !client.consultationBookingDate || 
                            new Date(client.consultationBookingDate) < new Date(isoConsultationDate);
        
        if (shouldUpdate) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              consultationBookingDate: isoConsultationDate,
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
            reason: client.consultationBookingDate ? 'Updated to newer date' : `Set from ${source}`,
          });
          
          console.log(`[sync-consultation-booking-dates] ✅ Updated client ${client.id} (${client.instagramUsername || client.firstName}): ${client.consultationBookingDate || 'null'} -> ${isoConsultationDate} (${source})`);
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
      message: `Synced ${results.updated} clients, skipped ${results.skipped}, errors: ${results.errors}`,
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
