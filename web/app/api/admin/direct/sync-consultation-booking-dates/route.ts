// web/app/api/admin/direct/sync-consultation-booking-dates/route.ts
// Endpoint для синхронізації consultationBookingDate з Altegio GET /records API

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
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
      console.log('[sync-consultation-booking-dates] ALTEGIO_COMPANY_ID not set or invalid, no API calls');
    }
    
    /** Затримка між викликами API (rate limit Altegio). */
    const API_DELAY_MS = 250;
    
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
    
    // Оновлюємо клієнтів тільки з даних API (GET /records)
    for (const client of allClients) {
      try {
        if (!client.altegioClientId) {
          results.skipped++;
          continue;
        }
        
        let latestConsultationDate: string | null = null;
        let isOnlineConsultation: boolean | null = null;
        
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
            }
          }
          await new Promise((r) => setTimeout(r, API_DELAY_MS));
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
            reason: client.consultationBookingDate ? 'Updated to newer date' : 'Set from api',
          });
          
          console.log(`[sync-consultation-booking-dates] ✅ Updated client ${client.id} (${client.instagramUsername || client.firstName}): ${client.consultationBookingDate || 'null'} -> ${isoConsultationDate} (api)`);
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
