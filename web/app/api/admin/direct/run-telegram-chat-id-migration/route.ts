// web/app/api/admin/direct/run-telegram-chat-id-migration/route.ts
// Endpoint для виконання міграції зміни типу telegramChatId з Int на BigInt

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  return false;
}

/**
 * POST - виконати міграцію зміни типу telegramChatId
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results: string[] = [];
    
    // Перевіряємо поточний тип колонки
    results.push('Перевірка поточного типу колонки telegramChatId...');
    try {
      const columnInfo = await prisma.$queryRawUnsafe(`
        SELECT 
          column_name, 
          data_type, 
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = 'direct_masters' 
        AND column_name = 'telegramChatId'
      `);
      
      results.push(`Поточний стан колонки: ${JSON.stringify(columnInfo, null, 2)}`);
    } catch (err) {
      results.push(`⚠️ Не вдалося перевірити колонку: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Виконуємо міграцію через Prisma migrate deploy
    results.push('\nВиконання міграції через Prisma migrate deploy...');
    try {
      const { stdout, stderr } = await execAsync(
        'npx prisma migrate deploy',
        { cwd: process.cwd(), timeout: 60000 }
      );
      
      if (stdout) results.push(stdout);
      if (stderr && !stderr.includes('warning') && !stderr.includes('info')) {
        results.push(stderr);
      }
      
      // Перевіряємо, чи міграція була виконана
      const migrationApplied = stdout.includes('Applied migration') || stdout.includes('No pending migrations');
      if (migrationApplied) {
        results.push('✅ Міграція виконана успішно через Prisma migrate deploy!');
      } else {
        results.push('ℹ️ Міграція може бути вже застосована або не знайдена.');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push(`❌ Помилка міграції через Prisma: ${errorMsg}`);
      
      // Якщо помилка про те, що міграція вже застосована, це нормально
      if (errorMsg.includes('already') || errorMsg.includes('No pending migrations') || errorMsg.includes('already applied')) {
        results.push('ℹ️ Міграція вже застосована або не знайдена.');
      } else {
        // Якщо Prisma migrate не спрацював, спробуємо через db push
        results.push('\nСпроба через Prisma db push...');
        try {
          const { stdout: pushStdout, stderr: pushStderr } = await execAsync(
            'npx prisma db push --accept-data-loss',
            { cwd: process.cwd(), timeout: 60000 }
          );
          
          if (pushStdout) results.push(pushStdout);
          if (pushStderr && !pushStderr.includes('warning') && !pushStderr.includes('info')) {
            results.push(pushStderr);
          }
          results.push('✅ Схема оновлена через Prisma db push!');
        } catch (pushErr) {
          const pushErrorMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          results.push(`❌ Помилка db push: ${pushErrorMsg}`);
          return NextResponse.json({
            ok: false,
            error: 'Не вдалося виконати міграцію. Можливо, потрібні права власника таблиці або виконати міграцію вручну через Prisma CLI.',
            results: results.join('\n'),
            recommendation: 'Спробуйте виконати вручну: npx prisma migrate deploy або npx prisma db push',
          }, { status: 500 });
        }
      }
    }

    // Перевіряємо результат
    results.push('\nПеревірка результату...');
    try {
      const columnInfo = await prisma.$queryRawUnsafe(`
        SELECT 
          column_name, 
          data_type, 
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = 'direct_masters' 
        AND column_name = 'telegramChatId'
      `);
      
      results.push(`Новий стан колонки: ${JSON.stringify(columnInfo, null, 2)}`);
      
      // Перевіряємо, чи є записи з великими chatId
      const mastersWithChatId = await prisma.directMaster.findMany({
        where: { telegramChatId: { not: null } },
        select: { id: true, name: true, telegramChatId: true },
      });
      
      results.push(`\nЗнайдено ${mastersWithChatId.length} майстрів з telegramChatId`);
      if (mastersWithChatId.length > 0) {
        results.push('Приклади:');
        mastersWithChatId.slice(0, 3).forEach(m => {
          results.push(`  - ${m.name}: ${m.telegramChatId}`);
        });
      }
    } catch (err) {
      results.push(`⚠️ Не вдалося перевірити результат: ${err instanceof Error ? err.message : String(err)}`);
    }

    return NextResponse.json({
      ok: true,
      message: 'Міграція виконана успішно',
      results: results.join('\n'),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[run-telegram-chat-id-migration] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

