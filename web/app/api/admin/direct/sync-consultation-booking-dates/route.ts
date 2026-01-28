// web/app/api/admin/direct/sync-consultation-booking-dates/route.ts
// Endpoint для синхронізації consultationBookingDate з вебхуків (тільки для консультацій)

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { kvRead } from '@/lib/kv';

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
    
    console.log(`[sync-consultation-booking-dates] Found ${clientConsultationMap.size} clients with consultations`);
    
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
    
    const results = {
      total: allClients.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [] as Array<{
        clientId: string;
        instagramUsername: string | null;
        altegioClientId: number | null;
        oldConsultationBookingDate: string | null;
        newConsultationBookingDate: string;
        reason: string;
      }>,
    };
    
    // Оновлюємо клієнтів
    for (const client of allClients) {
      try {
        if (!client.altegioClientId) {
          results.skipped++;
          continue;
        }
        
        // Знаходимо найновішу консультацію для цього клієнта
        const consultations = clientConsultationMap.get(client.altegioClientId) || [];
        if (consultations.length === 0) {
          results.skipped++;
          continue;
        }
        
        // Знаходимо найновішу дату консультації
        let latestConsultationDate: string | null = null;
        let latestConsultation: any = null;
        
        for (const consultation of consultations) {
          const consultationDate = new Date(consultation.datetime);
          if (!latestConsultationDate || new Date(latestConsultationDate) < consultationDate) {
            latestConsultationDate = consultation.datetime;
            latestConsultation = consultation;
          }
        }
        
        if (!latestConsultationDate) {
          results.skipped++;
          continue;
        }
        
        // Перевіряємо, чи потрібно оновити
        // Оновлюємо, якщо consultationBookingDate відсутній або якщо знайдена дата новіша
        const shouldUpdate = !client.consultationBookingDate || 
                            new Date(client.consultationBookingDate) < new Date(latestConsultationDate);
        
        if (shouldUpdate) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              consultationBookingDate: latestConsultationDate,
              isOnlineConsultation: latestConsultation.services.some((s: any) => {
                const title = (s.title || s.name || '').toLowerCase();
                return /онлайн/i.test(title) || /online/i.test(title);
              }),
            },
          });
          
          results.updated++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            oldConsultationBookingDate: client.consultationBookingDate ? new Date(client.consultationBookingDate).toISOString() : null,
            newConsultationBookingDate: latestConsultationDate,
            reason: client.consultationBookingDate ? 'Updated to newer date' : 'Set from webhooks',
          });
          
          console.log(`[sync-consultation-booking-dates] ✅ Updated client ${client.id} (${client.instagramUsername || client.firstName}): ${client.consultationBookingDate || 'null'} -> ${latestConsultationDate}`);
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
