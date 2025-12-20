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
    try {
      results.push('\nВиконання міграції БД...');
      // Використовуємо migrate deploy для production (без інтерактивності)
      const { stdout: migrateStdout, stderr: migrateStderr } = await execAsync(
        'npx prisma migrate deploy',
        { cwd: process.cwd() }
      );
      if (migrateStdout) results.push(migrateStdout);
      if (migrateStderr && !migrateStderr.includes('warning')) results.push(migrateStderr);
      results.push('✅ Міграція виконана');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push(`❌ Помилка міграції: ${errorMsg}`);
      
      // Якщо помилка про те, що міграцій немає, спробуємо створити їх
      if (errorMsg.includes('No migrations found') || errorMsg.includes('migration')) {
        try {
          results.push('\nСпроба створити міграцію...');
          const { stdout: createStdout, stderr: createStderr } = await execAsync(
            'npx prisma migrate dev --name init_direct --create-only',
            { cwd: process.cwd() }
          );
          if (createStdout) results.push(createStdout);
          if (createStderr && !createStderr.includes('warning')) results.push(createStderr);
          
          // Тепер виконуємо міграцію
          const { stdout: applyStdout, stderr: applyStderr } = await execAsync(
            'npx prisma migrate deploy',
            { cwd: process.cwd() }
          );
          if (applyStdout) results.push(applyStdout);
          if (applyStderr && !applyStderr.includes('warning')) results.push(applyStderr);
          results.push('✅ Міграція створена та виконана');
          success = true;
        } catch (createErr) {
          const createErrorMsg = createErr instanceof Error ? createErr.message : String(createErr);
          results.push(`❌ Помилка створення міграції: ${createErrorMsg}`);
          success = false;
        }
      } else {
        success = false;
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
