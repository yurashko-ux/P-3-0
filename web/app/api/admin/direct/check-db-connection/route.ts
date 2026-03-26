// web/app/api/admin/direct/check-db-connection/route.ts
// Діагностичний endpoint для перевірки підключення до бази даних

import { NextRequest, NextResponse } from 'next/server';
import { getDbHostForLog, getPrismaResolveMode, prisma } from '@/lib/prisma';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;

  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;

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

  // Для Prisma Postgres в Vercel використовується PRISMA_DATABASE_URL; фактичний хост — як у Prisma Client (resolveDatabaseUrl)
  const databaseUrl = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || '';
  const diagnostics: any = {
    timestamp: new Date().toISOString(),
    databaseUrl: {
      exists: !!databaseUrl,
      length: databaseUrl.length,
      preview: databaseUrl 
        ? `${databaseUrl.substring(0, 30)}...${databaseUrl.substring(databaseUrl.length - 15)}`
        : 'NOT SET',
      containsPooler: databaseUrl.includes('pooler') || false,
      containsPgBouncer: databaseUrl.includes('pgbouncer') || false,
      containsPrisma: databaseUrl.includes('prisma') || false,
      host: databaseUrl.match(/@([^:]+)/)?.[1] || 'unknown',
      port: databaseUrl.match(/:(\d+)\//)?.[1] || 'unknown',
      /** Хост після resolveDatabaseUrl() у lib/prisma.ts (той самий, що використовує runtime). */
      effectiveHostForPrismaClient: getDbHostForLog(),
      prismaResolveMode: getPrismaResolveMode(),
    },
    tests: [] as any[],
    recommendations: [] as string[],
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
  
  // Додаємо рекомендації на основі результатів
  if (!diagnostics.databaseUrl.exists) {
    diagnostics.recommendations.push('❌ PRISMA_DATABASE_URL або DATABASE_URL не налаштовано');
    diagnostics.recommendations.push('Для Prisma Postgres в Vercel автоматично створюється PRISMA_DATABASE_URL');
    diagnostics.recommendations.push('Перевірте: Vercel Dashboard → ваш проект → Settings → Environment Variables');
    diagnostics.recommendations.push('Якщо PRISMA_DATABASE_URL відсутній, переконайтеся, що база "CRM-P-3-0" підключена до проекту');
  } else if (!allTestsPassed) {
    diagnostics.recommendations.push('⚠️ База даних недоступна');
    diagnostics.recommendations.push('Перевірте статус бази даних: Vercel Dashboard → Storage → "CRM-P-3-0"');
    diagnostics.recommendations.push('Переконайтеся, що база активна (статус: Active/Running)');
    diagnostics.recommendations.push('Якщо база неактивна - спробуйте перезапустити її або зверніться до підтримки Vercel');

    const hasP1001 = diagnostics.tests.some((t: any) => t.code === 'P1001');
    const metaHost = diagnostics.tests.find((t: any) => t.meta?.database_host)?.meta?.database_host;
    if (hasP1001 && (metaHost === 'db.prisma.io' || String(diagnostics.databaseUrl.host || '').includes('prisma'))) {
      diagnostics.recommendations.push(
        'P1001 до db.prisma.io: перевірте Prisma Console / статус Prisma Postgres; оновіть PRISMA_DATABASE_URL у Vercel.'
      );
      if (process.env.DATABASE_URL && process.env.PRISMA_DATABASE_URL && process.env.DATABASE_URL !== process.env.PRISMA_DATABASE_URL) {
        diagnostics.recommendations.push(
          'Якщо DATABASE_URL — робочий прямий PostgreSQL до тієї ж БД: додайте USE_DATABASE_URL_FOR_PRISMA=1 у Vercel (лише після перевірки, що міграції та дані збігаються).'
        );
      }
    }
    
    if (!diagnostics.databaseUrl.containsPooler && !diagnostics.databaseUrl.containsPgBouncer) {
      diagnostics.recommendations.push('💡 Для Prisma Postgres в Vercel рекомендується використовувати connection pooler URL');
      diagnostics.recommendations.push('Перевірте документацію Prisma Postgres для отримання pooler URL');
    }
  } else {
    diagnostics.recommendations.push('✅ База даних працює нормально');
  }
  
  return NextResponse.json({
    ok: allTestsPassed,
    diagnostics,
    recommendations: diagnostics.recommendations,
  });
}
