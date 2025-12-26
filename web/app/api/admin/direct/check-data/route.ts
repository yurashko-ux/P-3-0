// web/app/api/admin/direct/check-data/route.ts
// Діагностика: перевірка наявності даних в Postgres та KV

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, directKeys } from '@/lib/kv';
import { getAllDirectClients, getAllDirectStatuses } from '@/lib/direct-store';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const results: any = {
      postgres: {
        clients: { count: 0, error: null as string | null },
        statuses: { count: 0, error: null as string | null },
        masters: { count: 0, error: null as string | null },
      },
      kv: {
        clients: { count: 0, error: null as string | null },
        statuses: { count: 0, error: null as string | null },
      },
    };

    // Перевіряємо Postgres
    try {
      const clients = await getAllDirectClients();
      results.postgres.clients.count = clients.length;
      results.postgres.clients.sample = clients.slice(0, 3).map(c => ({
        id: c.id,
        username: c.instagramUsername,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      }));
    } catch (err) {
      results.postgres.clients.error = err instanceof Error ? err.message : String(err);
    }

    try {
      const statuses = await getAllDirectStatuses();
      results.postgres.statuses.count = statuses.length;
    } catch (err) {
      results.postgres.statuses.error = err instanceof Error ? err.message : String(err);
    }

    try {
      const masters = await prisma.directMaster.findMany({ where: { isActive: true } });
      results.postgres.masters.count = masters.length;
    } catch (err) {
      results.postgres.masters.error = err instanceof Error ? err.message : String(err);
    }

    // Перевіряємо KV
    try {
      const clientIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
      if (clientIndex) {
        let parsed: any;
        if (typeof clientIndex === 'string') {
          try {
            parsed = JSON.parse(clientIndex);
          } catch {
            parsed = clientIndex;
          }
        } else {
          parsed = clientIndex;
        }
        
        if (Array.isArray(parsed)) {
          results.kv.clients.count = parsed.filter((id: any) => 
            typeof id === 'string' && id.startsWith('direct_')
          ).length;
        }
      }
    } catch (err) {
      results.kv.clients.error = err instanceof Error ? err.message : String(err);
    }

    try {
      const statusIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (statusIndex) {
        let parsed: any;
        if (typeof statusIndex === 'string') {
          try {
            parsed = JSON.parse(statusIndex);
          } catch {
            parsed = statusIndex;
          }
        } else {
          parsed = statusIndex;
        }
        
        if (Array.isArray(parsed)) {
          results.kv.statuses.count = parsed.length;
        }
      }
    } catch (err) {
      results.kv.statuses.error = err instanceof Error ? err.message : String(err);
    }

    // Перевіряємо напряму через SQL
    let directSqlCount = 0;
    try {
      const sqlResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM direct_clients
      `;
      if (sqlResult && sqlResult[0]) {
        directSqlCount = Number(sqlResult[0].count);
      }
    } catch (err) {
      console.warn('[check-data] SQL count failed:', err);
    }

    return NextResponse.json({
      ok: true,
      summary: {
        postgresClients: results.postgres.clients.count,
        postgresStatuses: results.postgres.statuses.count,
        postgresMasters: results.postgres.masters.count,
        kvClients: results.kv.clients.count,
        kvStatuses: results.kv.statuses.count,
        directSqlCount,
      },
      details: results,
      recommendation: results.postgres.clients.count === 0 && results.kv.clients.count > 0
        ? 'Дані є в KV, але не в Postgres. Використайте кнопку "🔄 Відновити дані з KV"'
        : results.postgres.clients.count === 0 && results.kv.clients.count === 0
        ? 'Дані відсутні і в KV, і в Postgres. Потрібна синхронізація з KeyCRM або Altegio'
        : 'Дані присутні в Postgres',
    });
  } catch (error) {
    console.error('[check-data] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
