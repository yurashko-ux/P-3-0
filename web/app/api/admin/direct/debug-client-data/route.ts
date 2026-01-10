// web/app/api/admin/direct/debug-client-data/route.ts
// Діагностика даних конкретного клієнта з бази

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAllDirectClients } from '@/lib/direct-store';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  
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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const instagramUsername = req.nextUrl.searchParams.get('instagram');
    const clientId = req.nextUrl.searchParams.get('id');
    
    if (!instagramUsername && !clientId) {
      return NextResponse.json({ 
        error: 'Потрібно вказати instagram або id',
        usage: '/api/admin/direct/debug-client-data?instagram=kobra_best&secret=...'
      }, { status: 400 });
    }

    // Шукаємо клієнта в базі через Prisma (сирі дані)
    const dbClient = await prisma.directClient.findFirst({
      where: instagramUsername 
        ? { instagramUsername: instagramUsername.toLowerCase().trim() }
        : { id: clientId! }
    });

    if (!dbClient) {
      return NextResponse.json({ 
        error: 'Клієнт не знайдений в базі',
        instagram: instagramUsername,
        id: clientId
      }, { status: 404 });
    }

    // Шукаємо клієнта через getAllDirectClients (оброблені дані)
    const allClients = await getAllDirectClients();
    const processedClient = allClients.find(
      c => c.instagramUsername === dbClient.instagramUsername || c.id === dbClient.id
    );

    return NextResponse.json({
      success: true,
      instagramUsername: dbClient.instagramUsername,
      clientId: dbClient.id,
      rawData: {
        id: dbClient.id,
        instagramUsername: dbClient.instagramUsername,
        firstName: dbClient.firstName,
        lastName: dbClient.lastName,
        altegioClientId: dbClient.altegioClientId,
        consultationBookingDate: dbClient.consultationBookingDate,
        isOnlineConsultation: dbClient.isOnlineConsultation,
        isOnlineConsultationType: typeof dbClient.isOnlineConsultation,
        isOnlineConsultationRaw: dbClient.isOnlineConsultation,
        consultationAttended: dbClient.consultationAttended,
        signedUpForPaidService: dbClient.signedUpForPaidService,
        paidServiceDate: dbClient.paidServiceDate,
        state: dbClient.state,
        createdAt: dbClient.createdAt,
        updatedAt: dbClient.updatedAt,
      },
      processedData: processedClient ? {
        id: processedClient.id,
        instagramUsername: processedClient.instagramUsername,
        firstName: processedClient.firstName,
        lastName: processedClient.lastName,
        altegioClientId: processedClient.altegioClientId,
        consultationBookingDate: processedClient.consultationBookingDate,
        isOnlineConsultation: processedClient.isOnlineConsultation,
        isOnlineConsultationType: typeof processedClient.isOnlineConsultation,
        consultationAttended: processedClient.consultationAttended,
        signedUpForPaidService: processedClient.signedUpForPaidService,
        paidServiceDate: processedClient.paidServiceDate,
        state: processedClient.state,
        createdAt: processedClient.createdAt,
        updatedAt: processedClient.updatedAt,
      } : null,
      comparison: {
        isOnlineConsultationMatches: dbClient.isOnlineConsultation === processedClient?.isOnlineConsultation,
        consultationBookingDateMatches: 
          (dbClient.consultationBookingDate?.toISOString() || null) === (processedClient?.consultationBookingDate || null),
      },
      message: 'Дані успішно отримані',
    });
  } catch (err: any) {
    console.error('[debug-client-data] ❌ Помилка:', err);
    return NextResponse.json({ 
      error: 'Помилка при отриманні даних',
      message: err.message,
      stack: err.stack
    }, { status: 500 });
  }
}
