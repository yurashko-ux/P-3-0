// web/app/api/admin/direct/run-migration/route.ts
// Endpoint для виконання Prisma міграції (створення таблиць)

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST - виконати Prisma міграцію
 */
export async function POST(req: NextRequest) {
  try {
    // Перевіряємо, чи є DATABASE_URL
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        ok: false,
        error: 'DATABASE_URL не налаштовано в environment variables',
      }, { status: 500 });
    }

    const results: string[] = [];
    let success = true;

    // 1. Генеруємо Prisma Client
    try {
      results.push('Генерація Prisma Client...');
      const { stdout: generateStdout, stderr: generateStderr } = await execAsync(
        'npx prisma generate',
        { cwd: process.cwd() }
      );
      if (generateStdout) results.push(generateStdout);
      if (generateStderr && !generateStderr.includes('warning')) results.push(generateStderr);
      results.push('✅ Prisma Client згенеровано');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push(`❌ Помилка генерації: ${errorMsg}`);
      success = false;
    }

    // 2. Виконуємо міграцію (створюємо таблиці)
    // Спочатку пробуємо db push (створює таблиці без міграцій)
    try {
      results.push('\nСтворення таблиць через db push...');
      const { stdout: pushStdout, stderr: pushStderr } = await execAsync(
        'npx prisma db push --accept-data-loss',
        { cwd: process.cwd(), timeout: 60000 }
      );
      if (pushStdout) results.push(pushStdout);
      if (pushStderr && !pushStderr.includes('warning') && !pushStderr.includes('info')) {
        results.push(pushStderr);
      }
      results.push('✅ Таблиці створені через db push');
      success = true;
    } catch (pushErr) {
      const pushErrorMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      results.push(`⚠️ db push не вдався: ${pushErrorMsg}`);
      
      // Якщо db push не спрацював, пробуємо migrate deploy
      try {
        results.push('\nСпроба через migrate deploy...');
        const { stdout: migrateStdout, stderr: migrateStderr } = await execAsync(
          'npx prisma migrate deploy',
          { cwd: process.cwd(), timeout: 60000 }
        );
        if (migrateStdout) results.push(migrateStdout);
        if (migrateStderr && !migrateStderr.includes('warning')) results.push(migrateStderr);
        results.push('✅ Міграція виконана через migrate deploy');
        success = true;
      } catch (migrateErr) {
        const migrateErrorMsg = migrateErr instanceof Error ? migrateErr.message : String(migrateErr);
        results.push(`❌ migrate deploy також не вдався: ${migrateErrorMsg}`);
        
        // Остання спроба - створити міграцію вручну через SQL
        try {
          results.push('\nСпроба створити таблиці через SQL...');
          const { prisma } = await import('@/lib/prisma');
          
          // Створюємо таблицю статусів
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "direct_statuses" (
              "id" TEXT NOT NULL,
              "name" TEXT NOT NULL,
              "color" TEXT NOT NULL DEFAULT '#6b7280',
              "order" INTEGER NOT NULL DEFAULT 0,
              "isDefault" BOOLEAN NOT NULL DEFAULT false,
              "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" TIMESTAMP(3) NOT NULL,
              CONSTRAINT "direct_statuses_pkey" PRIMARY KEY ("id")
            )
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_statuses_order_idx" ON "direct_statuses"("order")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_statuses_isDefault_idx" ON "direct_statuses"("isDefault")
          `);
          
          // Створюємо таблицю клієнтів
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "direct_clients" (
              "id" TEXT NOT NULL,
              "instagramUsername" TEXT NOT NULL,
              "firstName" TEXT,
              "lastName" TEXT,
              "source" TEXT NOT NULL DEFAULT 'instagram',
              "state" TEXT,
              "firstContactDate" TIMESTAMP(3) NOT NULL,
              "statusId" TEXT NOT NULL,
              "masterId" TEXT,
              "consultationDate" TIMESTAMP(3),
              "visitedSalon" BOOLEAN NOT NULL DEFAULT false,
              "visitDate" TIMESTAMP(3),
              "signedUpForPaidService" BOOLEAN NOT NULL DEFAULT false,
              "paidServiceDate" TIMESTAMP(3),
              "signupAdmin" TEXT,
              "comment" TEXT,
              "altegioClientId" INTEGER,
              "lastMessageAt" TIMESTAMP(3),
              "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" TIMESTAMP(3) NOT NULL,
              CONSTRAINT "direct_clients_pkey" PRIMARY KEY ("id")
            )
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS "direct_clients_instagramUsername_key" ON "direct_clients"("instagramUsername")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_statusId_idx" ON "direct_clients"("statusId")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_masterId_idx" ON "direct_clients"("masterId")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_altegioClientId_idx" ON "direct_clients"("altegioClientId")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_state_idx" ON "direct_clients"("state")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_source_idx" ON "direct_clients"("source")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_firstContactDate_idx" ON "direct_clients"("firstContactDate")
          `);
          
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "direct_clients_createdAt_idx" ON "direct_clients"("createdAt")
          `);
          
          // Створюємо foreign key
          await prisma.$executeRawUnsafe(`
            DO $$ BEGIN
              ALTER TABLE "direct_clients" ADD CONSTRAINT "direct_clients_statusId_fkey" 
              FOREIGN KEY ("statusId") REFERENCES "direct_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
            EXCEPTION
              WHEN duplicate_object THEN null;
            END $$;
          `);
          
          results.push('✅ Таблиці створені через SQL');
          success = true;
        } catch (sqlErr) {
          const sqlErrorMsg = sqlErr instanceof Error ? sqlErr.message : String(sqlErr);
          results.push(`❌ SQL створення також не вдалося: ${sqlErrorMsg}`);
          success = false;
        }
      }
    }

    // 3. Перевіряємо, чи таблиці створені
    try {
      const { prisma } = await import('@/lib/prisma');
      const clientsCount = await prisma.directClient.count().catch(() => -1);
      const statusesCount = await prisma.directStatus.count().catch(() => -1);
      
      if (clientsCount >= 0 && statusesCount >= 0) {
        results.push(`\n✅ Таблиці створені успішно`);
        results.push(`   - direct_clients: доступна`);
        results.push(`   - direct_statuses: доступна`);
      } else {
        results.push(`\n⚠️ Таблиці можуть бути не створені`);
      }
    } catch (err) {
      results.push(`\n⚠️ Не вдалося перевірити таблиці: ${err instanceof Error ? err.message : String(err)}`);
    }

    return NextResponse.json({
      ok: success,
      message: success ? 'Міграція виконана успішно' : 'Міграція виконана з помилками',
      results: results.join('\n'),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[run-migration] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
