// web/app/api/admin/direct/check-db-connection/route.ts
// Діагностичний endpoint для перевірки підключення до бази даних

import { NextRequest, NextResponse } from 'next/server';
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

  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    databaseUrl: {
      exists: !!process.env.DATABASE_URL,
      length: process.env.DATABASE_URL?.length || 0,
      preview: process.env.DATABASE_URL 
        ? `${process.env.DATABASE_URL.substring(0, 20)}...${process.env.DATABASE_URL.substring(process.env.DATABASE_URL.length - 10)}`
        : 'NOT SET',
      containsPooler: process.env.DATABASE_URL?.includes('pooler') || false,
      containsPgBouncer: process.env.DATABASE_URL?.includes('pgbouncer') || false,
      containsPrisma: process.env.DATABASE_URL?.includes('prisma') || false,
    },
    tests: [] as any[],
  };

  // Тест 1: Простий запит до бази
  try {
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    diagnostics.tests.push({
      name: 'Simple query',
      success: true,
      result: result,
    });
  } catch (err: any) {
    diagnostics.tests.push({
      name: 'Simple query',
      success: false,
      error: err.message,
      code: err.code,
      meta: err.meta,
    });
  }

  // Тест 2: Перевірка таблиці direct_clients
  try {
    const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM "direct_clients"
    `;
    diagnostics.tests.push({
      name: 'Check direct_clients table',
      success: true,
      count: Number(count[0]?.count || 0),
    });
  } catch (err: any) {
    diagnostics.tests.push({
      name: 'Check direct_clients table',
      success: false,
      error: err.message,
      code: err.code,
      meta: err.meta,
    });
  }

  // Тест 3: Перевірка таблиці direct_statuses
  try {
    const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM "direct_statuses"
    `;
    diagnostics.tests.push({
      name: 'Check direct_statuses table',
      success: true,
      count: Number(count[0]?.count || 0),
    });
  } catch (err: any) {
    diagnostics.tests.push({
      name: 'Check direct_statuses table',
      success: false,
      error: err.message,
      code: err.code,
      meta: err.meta,
    });
  }

  // Тест 4: Перевірка таблиці direct_client_state_logs
  try {
    const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM "direct_client_state_logs"
    `;
    diagnostics.tests.push({
      name: 'Check direct_client_state_logs table',
      success: true,
      count: Number(count[0]?.count || 0),
    });
  } catch (err: any) {
    diagnostics.tests.push({
      name: 'Check direct_client_state_logs table',
      success: false,
      error: err.message,
      code: err.code,
      meta: err.meta,
      note: 'This table might not exist yet - it will be created automatically on first use',
    });
  }

  // Тест 5: Prisma findMany
  try {
    const clients = await prisma.directClient.findMany({ take: 1 });
    diagnostics.tests.push({
      name: 'Prisma findMany',
      success: true,
      found: clients.length,
    });
  } catch (err: any) {
    diagnostics.tests.push({
      name: 'Prisma findMany',
      success: false,
      error: err.message,
      code: err.code,
      meta: err.meta,
    });
  }

  const allTestsPassed = diagnostics.tests.every((t: any) => t.success);
  
  return NextResponse.json({
    ok: allTestsPassed,
    diagnostics,
    recommendations: allTestsPassed ? [] : [
      'Перевірте змінну оточення DATABASE_URL в Vercel',
      'Переконайтеся, що база даних "CRM-P-3-0" активна в Vercel Storage',
      'Можливо, потрібно перезапустити deployment після зміни змінних оточення',
      'Перевірте, чи використовується правильний connection string для Prisma Postgres',
    ],
  });
}
