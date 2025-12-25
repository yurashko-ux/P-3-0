// web/app/api/admin/direct/check-migration/route.ts
// Endpoint для перевірки міграції Direct розділу на Postgres

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAllDirectClients, getAllDirectStatuses } from '@/lib/direct-store';
import { kvRead, directKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET - перевірити стан міграції
 */
export async function GET(req: NextRequest) {
  try {
    // Перевіряємо підключення до Postgres
    let postgresConnected = false;
    let postgresError: string | null = null;
    let postgresClientsCount = 0;
    let postgresStatusesCount = 0;
    
    try {
      await prisma.$connect();
      postgresConnected = true;
      
      // Перевіряємо кількість клієнтів та статусів в Postgres
      postgresClientsCount = await prisma.directClient.count();
      postgresStatusesCount = await prisma.directStatus.count();
    } catch (err) {
      postgresError = err instanceof Error ? err.message : String(err);
      console.error('[check-migration] Postgres connection error:', err);
    }
    
    // Перевіряємо дані в KV (старий store)
    let kvClientsCount = 0;
    let kvStatusesCount = 0;
    let kvError: string | null = null;
    
    try {
      const clientIndex = await kvRead.getRaw(directKeys.CLIENT_INDEX);
      if (clientIndex) {
        try {
          const parsed = JSON.parse(clientIndex);
          if (Array.isArray(parsed)) {
            kvClientsCount = parsed.filter((id: any) => typeof id === 'string' && id.startsWith('direct_')).length;
          }
        } catch {
          // Ігноруємо помилки парсингу
        }
      }
      
      const statusIndex = await kvRead.getRaw(directKeys.STATUS_INDEX);
      if (statusIndex) {
        try {
          const parsed = JSON.parse(statusIndex);
          if (Array.isArray(parsed)) {
            kvStatusesCount = parsed.filter((id: any) => typeof id === 'string' && id.length > 0).length;
          }
        } catch {
          // Ігноруємо помилки парсингу
        }
      }
    } catch (err) {
      kvError = err instanceof Error ? err.message : String(err);
    }
    
    // Перевіряємо через новий store (який використовує Postgres)
    let storeClientsCount = 0;
    let storeStatusesCount = 0;
    let storeError: string | null = null;
    
    try {
      const clients = await getAllDirectClients();
      const statuses = await getAllDirectStatuses();
      storeClientsCount = clients.length;
      storeStatusesCount = statuses.length;
    } catch (err) {
      storeError = err instanceof Error ? err.message : String(err);
    }
    
    // Визначаємо стан міграції
    const isMigrated = postgresConnected && postgresClientsCount > 0;
    const migrationStatus = isMigrated 
      ? '✅ Міграція виконана - дані в Postgres'
      : postgresConnected && postgresClientsCount === 0
      ? '⚠️ Postgres підключено, але даних немає (потрібна міграція)'
      : postgresConnected
      ? '⚠️ Postgres підключено, але є помилки'
      : '❌ Postgres не підключено';
    
    return NextResponse.json({
      ok: true,
      migration: {
        status: migrationStatus,
        isMigrated,
        postgres: {
          connected: postgresConnected,
          error: postgresError,
          clientsCount: postgresClientsCount,
          statusesCount: postgresStatusesCount,
        },
        kv: {
          clientsCount: kvClientsCount,
          statusesCount: kvStatusesCount,
          error: kvError,
        },
        store: {
          clientsCount: storeClientsCount,
          statusesCount: storeStatusesCount,
          error: storeError,
        },
        recommendation: isMigrated
          ? 'Міграція виконана успішно. Дані зберігаються в Postgres.'
          : postgresConnected
          ? 'Потрібно виконати міграцію даних з KV → Postgres через /api/admin/direct/migrate-data'
          : 'Перевірте DATABASE_URL в environment variables та виконайте `npx prisma migrate dev`',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[check-migration] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

