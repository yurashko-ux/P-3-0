// web/app/api/admin/direct/sync-paid-service-dates/route.ts
// Endpoint для синхронізації paidServiceDate з вебхуків (тільки для платних послуг)

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
 * Перевіряє, чи є платна послуга (не консультація)
 * Платні послуги: нарощування або будь-яка інша послуга, яка не є консультацією
 */
function hasPaidService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) {
    return false;
  }
  
  // Якщо є хоча б одна послуга, яка не є консультацією - це платна послуга
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    // Пропускаємо консультації
    if (/консультаці/i.test(title)) {
      return false;
    }
    // Якщо це не консультація - це платна послуга
    return true;
  });
}

/**
 * POST - синхронізувати paidServiceDate з вебхуків для платних послуг
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = new PrismaClient();
    
    // Отримуємо всі записи з records:log
    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    
    console.log(`[sync-paid-service-dates] Found ${rawItems.length} records in records:log`);
    
    // Парсимо записи (обробляємо можливий формат { value: "..." } від Upstash)
    const records = rawItems
      .map((raw) => {
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
      })
      .filter((r) => r && r.clientId && r.datetime);
    
    console.log(`[sync-paid-service-dates] Parsed ${records.length} valid records`);
    
    // Групуємо записи по клієнтам та датам
    const clientRecordsMap = new Map<string, Array<{
      datetime: string;
      services: any[];
      visitId: number;
      recordId: number;
    }>>();
    
    for (const record of records) {
      const clientId = record.clientId || record.data?.clientId;
      if (!clientId) continue;
      
      const services = record.data?.services || record.services || [];
      if (!Array.isArray(services) || services.length === 0) continue;
      
      // Пропускаємо консультації
      if (isConsultationService(services)) continue;
      
      // Перевіряємо, чи є платна послуга
      if (!hasPaidService(services)) continue;
      
      const datetime = record.datetime || record.data?.datetime;
      if (!datetime) continue;
      
      const key = `${clientId}_${datetime}`;
      if (!clientRecordsMap.has(key)) {
        clientRecordsMap.set(key, []);
      }
      
      clientRecordsMap.get(key)!.push({
        datetime,
        services,
        visitId: record.visitId || 0,
        recordId: record.recordId || 0,
      });
    }
    
    console.log(`[sync-paid-service-dates] Found ${clientRecordsMap.size} unique client-date combinations with paid services`);
    
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
        paidServiceDate: true,
        signedUpForPaidService: true,
      },
    });
    
    console.log(`[sync-paid-service-dates] Found ${allClients.length} clients with altegioClientId`);
    
    const results = {
      total: allClients.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [] as Array<{
        clientId: string;
        instagramUsername: string | null;
        altegioClientId: number | null;
        oldPaidServiceDate: string | null;
        newPaidServiceDate: string;
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
        
        // Знаходимо записи для цього клієнта
        let latestPaidServiceDate: string | null = null;
        let latestRecord: any = null;
        
        for (const [key, records] of clientRecordsMap.entries()) {
          if (key.startsWith(`${client.altegioClientId}_`)) {
            for (const record of records) {
              const recordDate = new Date(record.datetime);
              if (!latestPaidServiceDate || new Date(latestPaidServiceDate) < recordDate) {
                latestPaidServiceDate = record.datetime;
                latestRecord = record;
              }
            }
          }
        }
        
        if (!latestPaidServiceDate) {
          results.skipped++;
          continue;
        }
        
        // Перевіряємо, чи потрібно оновити
        const shouldUpdate = !client.paidServiceDate || 
                            new Date(client.paidServiceDate) < new Date(latestPaidServiceDate);
        
        if (shouldUpdate) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              paidServiceDate: latestPaidServiceDate,
              signedUpForPaidService: true,
              updatedAt: new Date().toISOString(),
            },
          });
          
          results.updated++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            oldPaidServiceDate: client.paidServiceDate ? new Date(client.paidServiceDate).toISOString() : null,
            newPaidServiceDate: latestPaidServiceDate,
            reason: client.paidServiceDate ? 'Updated to newer date' : 'Set from webhooks',
          });
          
          console.log(`[sync-paid-service-dates] ✅ Updated client ${client.id} (${client.instagramUsername}): ${client.paidServiceDate || 'null'} -> ${latestPaidServiceDate}`);
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.errors++;
        console.error(`[sync-paid-service-dates] Error processing client ${client.id}:`, err);
      }
    }
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      ok: true,
      message: `Synced ${results.updated} clients, skipped ${results.skipped}, errors: ${results.errors}`,
      results,
    });
  } catch (error) {
    console.error('[sync-paid-service-dates] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
