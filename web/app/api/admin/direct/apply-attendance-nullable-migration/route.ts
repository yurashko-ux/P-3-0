// API endpoint для застосування міграції зміни consultationAttended та paidServiceAttended на nullable

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  // Перевірка через ADMIN_PASS (кука)
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  // Перевірка через token в query параметрах (для GET запитів)
  const tokenParam = req.nextUrl.searchParams.get('token');
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;

  // Перевірка через CRON_SECRET
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  // Якщо нічого не налаштовано, дозволяємо (для розробки)
  if (!ADMIN_PASS && !CRON_SECRET) return true;

  return false;
}

async function applyMigration() {
  const results: string[] = [];
  
  // 1. Перевіряємо поточний стан колонок
  results.push('Перевірка поточного стану колонок...');
  try {
    const columnInfo = await prisma.$queryRawUnsafe<Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>>(`
      SELECT 
        column_name, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'direct_clients' 
      AND column_name IN ('consultationAttended', 'paidServiceAttended')
      ORDER BY column_name
    `);
    
    results.push(`Знайдено ${columnInfo.length} колонок:`);
    columnInfo.forEach(col => {
      results.push(`  - ${col.column_name}: is_nullable=${col.is_nullable}, default=${col.column_default || 'NULL'}`);
    });
    
    // Перевіряємо, чи колонки вже nullable
    const consultationCol = columnInfo.find(c => c.column_name === 'consultationAttended');
    const paidServiceCol = columnInfo.find(c => c.column_name === 'paidServiceAttended');
    
    if (consultationCol?.is_nullable === 'YES' && paidServiceCol?.is_nullable === 'YES') {
      results.push('\n✅ Колонки вже nullable! Продовжуємо з оновленням даних...');
    } else {
      results.push('\n🔄 Колонки не nullable, змінюємо на nullable...');
      
      // 2. Виконуємо ALTER TABLE для зміни колонок на nullable
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "direct_clients" 
          ALTER COLUMN "consultationAttended" DROP NOT NULL,
          ALTER COLUMN "consultationAttended" DROP DEFAULT,
          ALTER COLUMN "paidServiceAttended" DROP NOT NULL,
          ALTER COLUMN "paidServiceAttended" DROP DEFAULT
      `);
      
      results.push('✅ Колонки змінено на nullable');
    }
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push(`⚠️ Помилка перевірки/зміни колонок: ${errorMsg}`);
    // Продовжуємо, можливо колонки вже змінені
  }
  
  // 3. Оновлюємо дані: встановлюємо NULL для всіх записів з false
  results.push('\n🔄 Оновлення даних...');
  try {
    const consultationResult = await prisma.$executeRawUnsafe(`
      UPDATE "direct_clients" 
      SET "consultationAttended" = NULL 
      WHERE "consultationAttended" = false
    `);
    
    const paidServiceResult = await prisma.$executeRawUnsafe(`
      UPDATE "direct_clients" 
      SET "paidServiceAttended" = NULL 
      WHERE "paidServiceAttended" = false
    `);
    
    results.push(`✅ Оновлено consultationAttended: ${consultationResult} записів`);
    results.push(`✅ Оновлено paidServiceAttended: ${paidServiceResult} записів`);
    
    return {
      success: true,
      message: 'Міграція застосована успішно',
      results: results.join('\n'),
    };
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push(`❌ Помилка оновлення даних: ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await applyMigration();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[apply-attendance-nullable-migration] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Помилка при застосуванні міграції',
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await applyMigration();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[apply-attendance-nullable-migration] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Помилка при застосуванні міграції',
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
