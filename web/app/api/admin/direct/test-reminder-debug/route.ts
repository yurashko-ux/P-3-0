// web/app/api/admin/direct/test-reminder-debug/route.ts
// Діагностичний endpoint для перевірки налаштувань нагадувань

import { NextRequest, NextResponse } from 'next/server';
import { TELEGRAM_ENV } from '@/lib/telegram/env';
import { getAdminChatIds, getMykolayChatId } from '@/lib/direct-reminders/telegram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const debug = {
      tokens: {
        TELEGRAM_BOT_TOKEN: TELEGRAM_ENV.BOT_TOKEN ? `${TELEGRAM_ENV.BOT_TOKEN.substring(0, 10)}...` : 'NOT SET',
        TELEGRAM_HOB_CLIENT_BOT_TOKEN: TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN ? `${TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN.substring(0, 10)}...` : 'NOT SET',
        usingToken: TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN ? 'SET' : 'NOT SET',
      },
      adminChatIds: {
        fromEnv: TELEGRAM_ENV.ADMIN_CHAT_IDS,
        fromRegistry: [] as number[],
        total: [] as number[],
      },
      mykolayChatId: null as number | null,
    };

    // Отримуємо chat IDs адміністраторів
    const adminChatIds = await getAdminChatIds();
    debug.adminChatIds.total = adminChatIds;

    // Отримуємо chat ID Миколая
    const mykolayChatId = await getMykolayChatId();
    debug.mykolayChatId = mykolayChatId;

    // Отримуємо chat IDs з реєстру майстрів
    const { getMasters } = await import('@/lib/photo-reports/service');
    const { getChatIdForMaster } = await import('@/lib/photo-reports/master-registry');
    const masters = getMasters();
    const admins = masters.filter(m => m.role === 'admin');
    
    for (const admin of admins) {
      const chatId = await getChatIdForMaster(admin.id);
      if (chatId) {
        debug.adminChatIds.fromRegistry.push(chatId);
      }
    }

    return NextResponse.json({
      ok: true,
      debug,
      message: 'Діагностична інформація про налаштування нагадувань',
    });
  } catch (err) {
    console.error('[test-reminder-debug] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
