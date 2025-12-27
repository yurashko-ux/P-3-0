// web/app/api/admin/direct/check-client-state/route.ts
// Endpoint для перевірки стану клієнта в базі даних

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByAltegioId } from '@/lib/direct-store';
import { prisma } from '@/lib/prisma';

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const altegioClientId = searchParams.get('altegioClientId');
    
    if (!altegioClientId) {
      return NextResponse.json({ 
        ok: false, 
        error: 'altegioClientId is required' 
      }, { status: 400 });
    }

    const clientIdNum = parseInt(altegioClientId, 10);
    if (isNaN(clientIdNum)) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Invalid altegioClientId' 
      }, { status: 400 });
    }

    // Отримуємо клієнта через функцію з direct-store
    const client = await getDirectClientByAltegioId(clientIdNum);
    
    // Також отримуємо напряму з бази для порівняння
    const dbClient = await prisma.directClient.findFirst({
      where: { altegioClientId: clientIdNum },
    });

    // Отримуємо останні зміни стану
    const stateLogs = await prisma.$queryRaw<Array<{
      id: string;
      clientId: string;
      state: string | null;
      previousState: string | null;
      reason: string | null;
      createdAt: Date;
    }>>`
      SELECT * FROM "direct_client_state_logs"
      WHERE "clientId" = ${dbClient?.id || ''}
      ORDER BY "createdAt" DESC
      LIMIT 10
    `;

    return NextResponse.json({
      ok: true,
      altegioClientId: clientIdNum,
      clientFromStore: client ? {
        id: client.id,
        instagramUsername: client.instagramUsername,
        state: client.state,
        altegioClientId: client.altegioClientId,
      } : null,
      clientFromDB: dbClient ? {
        id: dbClient.id,
        instagramUsername: dbClient.instagramUsername,
        state: dbClient.state,
        altegioClientId: dbClient.altegioClientId,
        updatedAt: dbClient.updatedAt.toISOString(),
      } : null,
      stateLogs: stateLogs.map(log => ({
        id: log.id,
        state: log.state,
        previousState: log.previousState,
        reason: log.reason,
        createdAt: log.createdAt.toISOString(),
      })),
      match: client?.state === dbClient?.state,
    });
  } catch (error) {
    console.error('[direct/check-client-state] Error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

