// web/app/api/admin/direct/remove-duplicate-client-states/route.ts
// API endpoint для видалення дублікатів стану "client" з історії для Altegio клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Отримуємо ВСІХ клієнтів (не тільки з Altegio, бо можуть бути клієнти, які отримали altegioClientId пізніше)
    const allClients = await prisma.directClient.findMany({
      select: {
        id: true,
        altegioClientId: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
      },
    });

    console.log(`[remove-duplicate-client-states] Found ${allClients.length} total clients`);

    const results: Array<{
      clientId: string;
      instagramUsername: string;
      deletedCount: number;
      keptLogId: string | null;
      isAltegioClient: boolean;
    }> = [];

    for (const client of allClients) {
      // Отримуємо всю історію для клієнта
      const allLogs = await prisma.directClientStateLog.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: 'asc' }, // Від найстарішого до найновішого
      });

      // Знаходимо всі логи зі станом "client"
      const clientStateLogs = allLogs.filter(log => log.state === 'client');

      if (clientStateLogs.length > 1) {
        // Є дублікати - залишаємо тільки перший (найстаріший)
        const firstLog = clientStateLogs[0];
        const duplicateLogs = clientStateLogs.slice(1); // Всі крім першого

        // Видаляємо дублікати
        for (const duplicateLog of duplicateLogs) {
          await prisma.directClientStateLog.delete({
            where: { id: duplicateLog.id },
          });
        }

        results.push({
          clientId: client.id,
          instagramUsername: client.instagramUsername,
          deletedCount: duplicateLogs.length,
          keptLogId: firstLog.id,
          isAltegioClient: !!client.altegioClientId,
        });

        console.log(`[remove-duplicate-client-states] ✅ Client ${client.instagramUsername} (Altegio: ${!!client.altegioClientId}): deleted ${duplicateLogs.length} duplicate "client" state logs, kept log ${firstLog.id}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Processed ${altegioClients.length} Altegio clients`,
      clientsWithDuplicates: results.length,
      results,
      summary: {
        totalClients: altegioClients.length,
        clientsWithDuplicates: results.length,
        totalDeletedLogs: results.reduce((sum, r) => sum + r.deletedCount, 0),
      },
    });
  } catch (error) {
    console.error('[remove-duplicate-client-states] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

