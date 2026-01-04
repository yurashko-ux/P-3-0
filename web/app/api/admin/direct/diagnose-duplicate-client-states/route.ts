// web/app/api/admin/direct/diagnose-duplicate-client-states/route.ts
// Діагностичний endpoint для пошуку дублікатів стану "client"

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Отримуємо всіх клієнтів
    const allClients = await prisma.directClient.findMany({
      select: {
        id: true,
        instagramUsername: true,
        firstName: true,
        lastName: true,
        altegioClientId: true,
        state: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: Array<{
      clientId: string;
      instagramUsername: string;
      name: string;
      altegioClientId: number | null;
      currentState: string | null;
      duplicateLogs: Array<{
        id: string;
        state: string | null;
        previousState: string | null;
        reason: string | null;
        createdAt: Date;
        metadata: string | null;
      }>;
      allLogs: Array<{
        id: string;
        state: string | null;
        previousState: string | null;
        reason: string | null;
        createdAt: Date;
      }>;
    }> = [];

    for (const client of allClients) {
      // Отримуємо всю історію для клієнта
      const allLogs = await prisma.directClientStateLog.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: 'asc' },
      });

      // Знаходимо всі логи зі станом "client"
      const clientStateLogs = allLogs.filter(log => log.state === 'client');

      if (clientStateLogs.length > 1) {
        results.push({
          clientId: client.id,
          instagramUsername: client.instagramUsername,
          name: [client.firstName, client.lastName].filter(Boolean).join(' ') || 'N/A',
          altegioClientId: client.altegioClientId,
          currentState: client.state,
          duplicateLogs: clientStateLogs,
          allLogs: allLogs.map(log => ({
            id: log.id,
            state: log.state,
            previousState: log.previousState,
            reason: log.reason,
            createdAt: log.createdAt,
          })),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      totalClients: allClients.length,
      clientsWithDuplicateClientStates: results.length,
      duplicates: results.map(r => ({
        clientId: r.clientId,
        instagramUsername: r.instagramUsername,
        name: r.name,
        altegioClientId: r.altegioClientId,
        currentState: r.currentState,
        duplicateCount: r.duplicateLogs.length,
        duplicateLogs: r.duplicateLogs.map(log => ({
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          reason: log.reason,
          metadata: log.metadata,
        })),
        allStates: r.allLogs.map(log => ({
          state: log.state,
          createdAt: log.createdAt.toISOString(),
          reason: log.reason,
        })),
      })),
    });
  } catch (error) {
    console.error('[diagnose-duplicate-client-states] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

