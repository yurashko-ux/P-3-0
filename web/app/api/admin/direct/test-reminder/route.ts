// web/app/api/admin/direct/test-reminder/route.ts
// API endpoint для тестування нагадувань

import { NextRequest, NextResponse } from 'next/server';
import { sendDirectReminderToAdmins, sendRepeatReminderToAdmins } from '@/lib/direct-reminders/telegram';
import type { DirectReminder } from '@/lib/direct-reminders/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { type = 'new', reminderId } = body;

    // Перевіряємо наявність токена
    const { TELEGRAM_ENV } = await import('@/lib/telegram/env');
    console.log('[test-reminder] HOB_CLIENT_BOT_TOKEN:', TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN ? 'SET' : 'NOT SET');
    console.log('[test-reminder] BOT_TOKEN (fallback):', TELEGRAM_ENV.BOT_TOKEN ? 'SET' : 'NOT SET');

    // Створюємо тестове нагадування
    const testReminder: DirectReminder = {
      id: reminderId || `test_reminder_${Date.now()}`,
      directClientId: 'test_client_id',
      altegioClientId: 123456,
      visitId: 789012,
      recordId: 345678,
      instagramUsername: 'test_client',
      phone: '+380501234567',
      clientName: 'Тестовий Клієнт',
      visitDate: new Date().toISOString(),
      serviceName: 'Тестова послуга',
      status: type === 'repeat' ? 'no-call' : 'pending',
      scheduledFor: new Date().toISOString(),
      reminderCount: type === 'repeat' ? 1 : 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(type === 'repeat' && { lastReminderAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }),
    };

    // Отримуємо інформацію про chat IDs перед надсиланням
    const { getAdminChatIds, getMykolayChatId } = await import('@/lib/direct-reminders/telegram');
    const adminChatIds = await getAdminChatIds();
    const mykolayChatId = await getMykolayChatId();
    const allChatIds = [...adminChatIds];
    if (mykolayChatId && !allChatIds.includes(mykolayChatId)) {
      allChatIds.push(mykolayChatId);
    }

    console.log('[test-reminder] Chat IDs before sending:', {
      adminChatIds,
      mykolayChatId,
      allChatIds,
    });

    if (allChatIds.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Не знайдено chat IDs адміністраторів. Встановіть TELEGRAM_ADMIN_CHAT_IDS або зареєструйте адміністраторів через /start в боті.',
        debug: {
          adminChatIds,
          mykolayChatId,
          totalChatIds: allChatIds.length,
        },
      }, { status: 400 });
    }

    try {
      if (type === 'repeat') {
        await sendRepeatReminderToAdmins(testReminder, true);
      } else {
        await sendDirectReminderToAdmins(testReminder, true);
      }
    } catch (err) {
      console.error('[test-reminder] Error sending reminder:', err);
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        debug: {
          adminChatIds,
          mykolayChatId,
          totalChatIds: allChatIds.length,
        },
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: type === 'repeat' 
        ? 'Повторне нагадування надіслано адміністраторам'
        : 'Нагадування надіслано адміністраторам',
      reminder: {
        id: testReminder.id,
        clientName: testReminder.clientName,
        phone: testReminder.phone,
        instagramUsername: testReminder.instagramUsername,
        serviceName: testReminder.serviceName,
        type,
      },
      debug: {
        adminChatIds,
        mykolayChatId,
        totalChatIds: allChatIds.length,
        sentTo: allChatIds,
      },
    });
  } catch (err) {
    console.error('[test-reminder] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

