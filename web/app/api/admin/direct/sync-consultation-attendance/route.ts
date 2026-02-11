// web/app/api/admin/direct/sync-consultation-attendance/route.ts
// Endpoint для синхронізації consultationAttended з вебхуків

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
 * POST - синхронізувати consultationAttended з вебхуків
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = new PrismaClient();
    
    // Отримуємо всі записи з records:log
    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    
    console.log(`[sync-consultation-attendance] Found ${rawItems.length} records in records:log`);
    
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
      .filter((r) => r && r.clientId && r.datetime && r.data?.services);
    
    console.log(`[sync-consultation-attendance] Parsed ${records.length} valid records`);
    
    // Фільтруємо записи з консультаціями та attendance
    const consultationRecords = records
      .filter((record) => {
        const services = record.data?.services || [];
        if (!Array.isArray(services) || services.length === 0) return false;
        
        const hasConsultation = isConsultationService(services);
        if (!hasConsultation) return false;
        
        // Перевіряємо, чи є attendance
        const attendance = record.data?.attendance ?? record.data?.visit_attendance ?? record.attendance;
        return attendance === 1 || attendance === 2 || attendance === -1;
      })
      .sort((a, b) => {
        // Сортуємо за датою (найновіші спочатку)
        const dateA = new Date(a.datetime || a.data?.datetime || 0);
        const dateB = new Date(b.datetime || b.data?.datetime || 0);
        return dateB.getTime() - dateA.getTime();
      });
    
    console.log(`[sync-consultation-attendance] Found ${consultationRecords.length} consultation records with attendance`);
    
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
        consultationAttended: true,
        consultationBookingDate: true,
      },
    });
    
    console.log(`[sync-consultation-attendance] Found ${allClients.length} clients with altegioClientId`);
    
    const results = {
      total: allClients.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [] as Array<{
        clientId: string;
        instagramUsername: string | null;
        altegioClientId: number | null;
        oldConsultationAttended: boolean | null;
        newConsultationAttended: boolean;
        datetime: string;
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
        
        // Знаходимо найновіший запис з консультацією для цього клієнта
        const clientRecords = consultationRecords.filter(
          (r) => r.clientId === client.altegioClientId
        );
        
        if (clientRecords.length === 0) {
          results.skipped++;
          continue;
        }
        
        // Беремо найновіший запис (вже відсортовані за датою)
        const latestRecord = clientRecords[0];
        const attendance = latestRecord.data?.attendance ?? latestRecord.data?.visit_attendance ?? latestRecord.attendance;
        const datetime = latestRecord.datetime || latestRecord.data?.datetime;
        
        if (!datetime) {
          results.skipped++;
          continue;
        }
        
        // Визначаємо нове значення consultationAttended на основі найновішого вебхука
        let newConsultationAttended: boolean | null = null;
        if (attendance === 1 || attendance === 2) {
          newConsultationAttended = true;
        } else if (attendance === -1) {
          newConsultationAttended = false;
        }
        
        if (newConsultationAttended === null) {
          results.skipped++;
          continue;
        }
        
        // Перевіряємо, чи потрібно оновити
        const shouldUpdate = client.consultationAttended !== newConsultationAttended;
        
        if (shouldUpdate) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              consultationAttended: newConsultationAttended,
            },
          });
          
          results.updated++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            oldConsultationAttended: client.consultationAttended,
            newConsultationAttended: newConsultationAttended,
            datetime,
            reason: newConsultationAttended ? 'Client attended consultation' : 'Client did not attend consultation',
          });
          
          console.log(`[sync-consultation-attendance] ✅ Updated client ${client.id} (${client.instagramUsername}): consultationAttended ${client.consultationAttended} -> ${newConsultationAttended}`);
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.errors++;
        console.error(`[sync-consultation-attendance] Error processing client ${client.id}:`, err);
      }
    }
    
    await prisma.$disconnect();
    
    return NextResponse.json({
      ok: true,
      message: `Synced ${results.updated} clients, skipped ${results.skipped}, errors: ${results.errors}`,
      results,
    });
  } catch (error) {
    console.error('[sync-consultation-attendance] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
