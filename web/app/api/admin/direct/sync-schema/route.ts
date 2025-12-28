// web/app/api/admin/direct/sync-schema/route.ts
// Endpoint для синхронізації Prisma схеми з базою даних (db push)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST - синхронізувати схему Prisma з базою даних
 * Це еквівалент `prisma db push`, але виконується через API
 */
export async function POST(req: NextRequest) {
  try {
    const results: string[] = [];
    
    // Перевіряємо, чи колонка вже існує
    try {
      const columnCheck = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'direct_masters' 
        AND column_name = 'telegramChatId'
      `;
      
      if (columnCheck.length > 0) {
        results.push('✅ Колонка telegramChatId вже існує в таблиці direct_masters');
        return NextResponse.json({
          ok: true,
          message: 'Колонка telegramChatId вже існує',
          results: results.join('\n'),
        });
      }
    } catch (checkErr) {
      results.push(`⚠️ Не вдалося перевірити наявність колонки: ${checkErr instanceof Error ? checkErr.message : String(checkErr)}`);
    }
    
    // Синхронізуємо схему - додаємо колонку через Prisma
    // Prisma db push працює через інтроспекцію схеми, але ми можемо виконати SQL напряму
    try {
      results.push('Синхронізація схеми Prisma з базою даних...');
      results.push('Додавання колонки telegramChatId...');
      
      // Використовуємо Prisma для виконання SQL
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "direct_masters" 
        ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER
      `);
      
      results.push('✅ Колонка telegramChatId додана успішно');
    } catch (alterErr: any) {
      const errorMsg = alterErr instanceof Error ? alterErr.message : String(alterErr);
      results.push(`❌ Помилка додавання колонки: ${errorMsg}`);
      
      // Якщо помилка про права - повертаємо детальну інформацію
      if (errorMsg.includes('permission') || errorMsg.includes('owner') || errorMsg.includes('42501')) {
        return NextResponse.json({
          ok: false,
          message: 'Недостатньо прав для зміни структури таблиці',
          results: results.join('\n'),
          error: errorMsg,
          solution: 'Потрібно додати колонку вручну через SQL клієнт або надати права користувачу бази даних',
          sql: `
ALTER TABLE "direct_masters" ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;
CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" ON "direct_masters"("telegramChatId");
          `.trim(),
        }, { status: 403 });
      }
      
      return NextResponse.json({
        ok: false,
        message: 'Не вдалося додати колонку telegramChatId',
        results: results.join('\n'),
        error: errorMsg,
      }, { status: 500 });
    }
    
    // Створюємо індекс
    try {
      results.push('Створення індексу для telegramChatId...');
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" 
        ON "direct_masters"("telegramChatId")
      `);
      results.push('✅ Індекс створено успішно');
    } catch (indexErr: any) {
      const errorMsg = indexErr instanceof Error ? indexErr.message : String(indexErr);
      results.push(`⚠️ Не вдалося створити індекс: ${errorMsg}`);
    }
    
    // Перевіряємо результат
    try {
      const verify = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'direct_masters' 
        AND column_name = 'telegramChatId'
      `;
      
      if (verify.length > 0) {
        results.push('\n✅ Перевірка: Колонка telegramChatId успішно додана до таблиці direct_masters');
        return NextResponse.json({
          ok: true,
          message: 'Схема синхронізована успішно',
          results: results.join('\n'),
        });
      } else {
        results.push('\n⚠️ Перевірка: Колонка не знайдена після додавання');
        return NextResponse.json({
          ok: false,
          message: 'Колонка не знайдена після додавання',
          results: results.join('\n'),
        }, { status: 500 });
      }
    } catch (verifyErr) {
      results.push(`\n⚠️ Не вдалося перевірити результат: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`);
      return NextResponse.json({
        ok: true,
        message: 'Синхронізація виконана, але перевірка не вдалася',
        results: results.join('\n'),
      });
    }
  } catch (err) {
    console.error('[sync-schema] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

