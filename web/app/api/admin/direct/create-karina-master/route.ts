// web/app/api/admin/direct/create-karina-master/route.ts
// Endpoint для створення майстра Каріни (дірект-менеджер)

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectMasters, saveDirectMaster } from '@/lib/direct-masters/store';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    // Перевіряємо, чи вже існує майстер з таким Telegram username
    const existingMasters = await getAllDirectMasters();
    const existingKarina = existingMasters.find(m => 
      m.telegramUsername?.toLowerCase().replace(/^@/, '') === 'ikariish'
    );

    if (existingKarina) {
      return NextResponse.json({
        ok: true,
        message: 'Майстер Каріна вже існує',
        master: existingKarina,
      });
    }

    // Створюємо нового майстра Каріну
    const karinaMaster = {
      id: randomUUID(),
      name: 'Каріна',
      telegramUsername: 'ikariish',
      telegramChatId: undefined, // Буде встановлено після реєстрації через /start
      role: 'direct-manager' as const,
      altegioStaffId: undefined, // Працює під логіном Вікторії, тому не встановлюємо
      isActive: true,
      order: 10, // Після Вікторії (яка має order: 6)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveDirectMaster(karinaMaster);

    return NextResponse.json({
      ok: true,
      message: 'Майстер Каріна успішно створено',
      master: saved,
    });
  } catch (err) {
    console.error('[create-karina-master] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

