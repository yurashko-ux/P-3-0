// web/app/api/admin/direct/cleanup-paid-service-dates/route.ts
// Endpoint для очищення paidServiceDate для клієнтів, у яких він встановлений для консультацій

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

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
 * POST - очистити paidServiceDate для клієнтів, у яких він встановлений для консультацій
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const prisma = new PrismaClient();
    
    // Отримуємо всіх клієнтів з paidServiceDate
    const clientsWithPaidServiceDate = await prisma.directClient.findMany({
      where: {
        paidServiceDate: {
          not: null,
        },
      },
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        paidServiceDate: true,
        consultationBookingDate: true,
        signedUpForPaidService: true,
        altegioClientId: true,
      },
    });

    console.log(`[cleanup-paid-service-dates] Found ${clientsWithPaidServiceDate.length} clients with paidServiceDate`);

    const results = {
      total: clientsWithPaidServiceDate.length,
      cleaned: 0,
      skipped: 0,
      errors: 0,
      details: [] as Array<{
        clientId: string;
        instagramUsername: string | null;
        reason: string;
        paidServiceDate: string | null;
        consultationBookingDate: string | null;
      }>,
    };

    // Перевіряємо кожного клієнта
    for (const client of clientsWithPaidServiceDate) {
      try {
        let shouldClean = false;
        let reason = '';

        // Варіант 1: paidServiceDate збігається з consultationBookingDate
        if (client.consultationBookingDate && client.paidServiceDate) {
          const paidDate = new Date(client.paidServiceDate);
          const consultationDate = new Date(client.consultationBookingDate);
          
          // Порівнюємо тільки дати (без часу)
          paidDate.setHours(0, 0, 0, 0);
          consultationDate.setHours(0, 0, 0, 0);
          
          if (paidDate.getTime() === consultationDate.getTime()) {
            shouldClean = true;
            reason = 'paidServiceDate matches consultationBookingDate';
          }
        }

        // Варіант 2: signedUpForPaidService = false, але paidServiceDate встановлений
        // Це означає, що paidServiceDate встановлений помилково
        if (!shouldClean && !client.signedUpForPaidService && client.paidServiceDate) {
          shouldClean = true;
          reason = 'signedUpForPaidService is false but paidServiceDate is set';
        }

        // Варіант 3: Перевіряємо записи в Altegio records:log
        // Якщо для цієї дати є тільки консультації - очищаємо
        if (!shouldClean && client.paidServiceDate && client.altegioClientId) {
          try {
            const { kvRead } = await import('@/lib/kv');
            const rawItems = await kvRead.lrange('altegio:records:log', 0, 999);
            
            const paidDate = new Date(client.paidServiceDate);
            paidDate.setHours(0, 0, 0, 0);
            
            let hasOnlyConsultations = true;
            let hasPaidService = false;
            
            for (const raw of rawItems) {
              try {
                const parsed = JSON.parse(raw);
                if (parsed.clientId === client.altegioClientId || parsed.data?.clientId === client.altegioClientId) {
                  const recordDate = parsed.datetime ? new Date(parsed.datetime) : null;
                  if (recordDate) {
                    recordDate.setHours(0, 0, 0, 0);
                    if (recordDate.getTime() === paidDate.getTime()) {
                      // Перевіряємо послуги
                      const services = parsed.data?.services || parsed.services || [];
                      if (Array.isArray(services) && services.length > 0) {
                        const hasConsultation = services.some((s: any) => {
                          const title = (s.title || s.name || '').toLowerCase();
                          return /консультаці/i.test(title);
                        });
                        const hasHairExtension = services.some((s: any) => {
                          const title = (s.title || s.name || '').toLowerCase();
                          return /нарощування/i.test(title);
                        });
                        
                        if (hasHairExtension || (!hasConsultation && services.length > 0)) {
                          hasPaidService = true;
                          hasOnlyConsultations = false;
                          break;
                        }
                      }
                    }
                  }
                }
              } catch {
                // Пропускаємо невалідні записи
              }
            }
            
            if (hasOnlyConsultations && !hasPaidService) {
              shouldClean = true;
              reason = 'Only consultations found for this date in Altegio records';
            }
          } catch (err) {
            console.warn(`[cleanup-paid-service-dates] Failed to check Altegio records for client ${client.id}:`, err);
          }
        }

        if (shouldClean) {
          await prisma.directClient.update({
            where: { id: client.id },
            data: {
              paidServiceDate: null,
              signedUpForPaidService: false,
              updatedAt: new Date().toISOString(),
            },
          });
          
          results.cleaned++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            reason,
            paidServiceDate: client.paidServiceDate,
            consultationBookingDate: client.consultationBookingDate,
          });
          
          console.log(`[cleanup-paid-service-dates] ✅ Cleaned paidServiceDate for client ${client.id} (${client.instagramUsername}): ${reason}`);
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.errors++;
        console.error(`[cleanup-paid-service-dates] Error processing client ${client.id}:`, err);
      }
    }

    await prisma.$disconnect();

    return NextResponse.json({
      ok: true,
      message: `Cleaned ${results.cleaned} clients, skipped ${results.skipped}, errors: ${results.errors}`,
      results,
    });
  } catch (error) {
    console.error('[cleanup-paid-service-dates] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
