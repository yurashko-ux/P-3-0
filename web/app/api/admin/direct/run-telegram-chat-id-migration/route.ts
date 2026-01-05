// web/app/api/admin/direct/run-telegram-chat-id-migration/route.ts
// Endpoint для виконання міграції зміни типу telegramChatId з Int на BigInt

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    // Виконуємо міграцію
    results.push('\nВиконання міграції...');
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "direct_masters" 
        ALTER COLUMN "telegramChatId" TYPE BIGINT 
        USING "telegramChatId"::BIGINT
      `);
      results.push('✅ Міграція виконана успішно!');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push(`❌ Помилка міграції: ${errorMsg}`);
      
      // Якщо помилка про те, що колонка вже має тип BIGINT, це нормально
      if (errorMsg.includes('already') || errorMsg.includes('BIGINT')) {
        results.push('ℹ️ Колонка вже має тип BIGINT, міграція не потрібна.');
      } else {
        return NextResponse.json({
          ok: false,
          error: errorMsg,
          results: results.join('\n'),
        }, { status: 500 });
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

