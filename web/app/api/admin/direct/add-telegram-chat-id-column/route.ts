// web/app/api/admin/direct/add-telegram-chat-id-column/route.ts
// Endpoint для додавання колонки telegramChatId до таблиці direct_masters

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST - додати колонку telegramChatId до таблиці direct_masters
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
    
    // Додаємо колонку telegramChatId
    try {
      results.push('Додавання колонки telegramChatId...');
      
      // Спочатку пробуємо надати права (якщо можливо)
      try {
        await prisma.$executeRawUnsafe(`
          GRANT ALL ON TABLE "direct_masters" TO CURRENT_USER;
        `);
        results.push('✅ Права надано (або вже були)');
      } catch (grantErr: any) {
        // Якщо не вдалося надати права - це нормально, продовжуємо
        results.push(`⚠️ Не вдалося надати права (це нормально): ${grantErr?.message?.substring(0, 100) || 'unknown'}`);
      }
      
      // Використовуємо $executeRawUnsafe, оскільки IF NOT EXISTS не підтримується в параметризованих запитах
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "direct_masters" 
        ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER
      `);
      
      results.push('✅ Колонка telegramChatId додана успішно');
    } catch (alterErr: any) {
      // Якщо колонка вже існує, це не помилка
      if (alterErr?.message?.includes('already exists') || alterErr?.message?.includes('duplicate column')) {
        results.push('✅ Колонка telegramChatId вже існує');
      } else {
        const errorMsg = alterErr instanceof Error ? alterErr.message : String(alterErr);
        results.push(`❌ Помилка додавання колонки: ${errorMsg}`);
        
        // Пробуємо через $executeRawUnsafe як fallback
        try {
          results.push('Спроба через альтернативний метод...');
          await prisma.$executeRawUnsafe(`
            DO $$ 
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'direct_masters' 
                AND column_name = 'telegramChatId'
              ) THEN
                ALTER TABLE "direct_masters" 
                ADD COLUMN "telegramChatId" INTEGER;
              END IF;
            END $$;
          `);
          results.push('✅ Колонка додана через альтернативний метод');
        } catch (fallbackErr) {
          const fallbackErrorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          results.push(`❌ Альтернативний метод також не вдався: ${fallbackErrorMsg}`);
          return NextResponse.json({
            ok: false,
            message: 'Не вдалося додати колонку telegramChatId',
            results: results.join('\n'),
            error: fallbackErrorMsg,
          }, { status: 500 });
        }
      }
    }
    
    // Створюємо індекс для telegramChatId
    try {
      results.push('Створення індексу для telegramChatId...');
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" 
        ON "direct_masters"("telegramChatId")
      `;
      results.push('✅ Індекс створено успішно');
    } catch (indexErr: any) {
      // Якщо індекс вже існує, це не помилка
      if (indexErr?.message?.includes('already exists') || indexErr?.message?.includes('duplicate')) {
        results.push('✅ Індекс вже існує');
      } else {
        const errorMsg = indexErr instanceof Error ? indexErr.message : String(indexErr);
        results.push(`⚠️ Не вдалося створити індекс: ${errorMsg}`);
      }
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
          message: 'Колонка telegramChatId успішно додана',
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
        message: 'Міграція виконана, але перевірка не вдалася',
        results: results.join('\n'),
      });
    }
  } catch (err) {
    console.error('[add-telegram-chat-id-column] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

