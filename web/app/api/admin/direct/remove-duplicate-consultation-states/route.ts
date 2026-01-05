// web/app/api/admin/direct/remove-duplicate-consultation-states/route.ts
// API endpoint для видалення дублікатів consultation-related станів з історії

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
    // Отримуємо ВСІХ клієнтів
    const allClients = await prisma.directClient.findMany({
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
      },
    });

    console.log(`[remove-duplicate-consultation-states] Found ${allClients.length} total clients`);

    const consultationStates = ['consultation', 'consultation-booked', 'consultation-no-show', 'consultation-rescheduled'];
    const results: Array<{
      clientId: string;
      instagramUsername: string;
      state: string;
      deletedCount: number;
      keptLogId: string | null;
    }> = [];

    for (const client of allClients) {
      // Перевіряємо кожен consultation-related стан
      for (const state of consultationStates) {
        // Отримуємо всю історію для клієнта з цим станом
        const stateLogs = await prisma.directClientStateLog.findMany({
          where: {
            clientId: client.id,
            state: state,
          },
          orderBy: { createdAt: 'asc' }, // Від найстарішого до найновішого
        });

        if (stateLogs.length > 1) {
          // Є дублікати - залишаємо тільки перший (найстаріший)
          const firstLog = stateLogs[0];
          const duplicateLogs = stateLogs.slice(1); // Всі крім першого

          // Видаляємо дублікати
          for (const duplicateLog of duplicateLogs) {
            await prisma.directClientStateLog.delete({
              where: { id: duplicateLog.id },
            });
          }

          results.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername,
            state: state,
            deletedCount: duplicateLogs.length,
            keptLogId: firstLog.id,
          });

          console.log(`[remove-duplicate-consultation-states] ✅ Client ${client.instagramUsername}: deleted ${duplicateLogs.length} duplicate "${state}" state logs, kept log ${firstLog.id}`);
        }
      }
    }

    const summaryByState = consultationStates.reduce((acc, state) => {
      const stateResults = results.filter(r => r.state === state);
      acc[state] = {
        clientsWithDuplicates: stateResults.length,
        totalDeletedLogs: stateResults.reduce((sum, r) => sum + r.deletedCount, 0),
      };
      return acc;
    }, {} as Record<string, { clientsWithDuplicates: number; totalDeletedLogs: number }>);
    
    return NextResponse.json({
      ok: true,
      message: `Processed ${allClients.length} clients`,
      clientsWithDuplicates: results.length,
      results,
      summary: {
        totalClients: allClients.length,
        clientsWithDuplicates: results.length,
        totalDeletedLogs: results.reduce((sum, r) => sum + r.deletedCount, 0),
        byState: summaryByState,
      },
    });
  } catch (error) {
    console.error('[remove-duplicate-consultation-states] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

