// web/app/api/admin/direct/send-missing-instagram-notifications/route.ts
// Відправка Telegram повідомлень для клієнтів без Instagram

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * POST - відправити Telegram повідомлення для клієнтів без Instagram
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[direct/send-missing-instagram-notifications] Finding clients without Instagram`);

    // Отримуємо всіх клієнтів
    const allClients = await getAllDirectClients();
    
    // Фільтруємо клієнтів без Instagram
    const clientsWithoutInstagram = allClients.filter(client => {
      const hasNoInstagramState = client.state === 'no-instagram';
      const hasMissingInstagramUsername = client.instagramUsername?.startsWith('missing_instagram_');
      return hasNoInstagramState || hasMissingInstagramUsername;
    });

    console.log(`[direct/send-missing-instagram-notifications] Found ${clientsWithoutInstagram.length} clients without Instagram`);

    if (clientsWithoutInstagram.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No clients without Instagram found',
        sent: 0,
        clients: [],
      });
    }

    // Імпортуємо функції для відправки повідомлень
    const { sendMessage } = await import('@/lib/telegram/api');
    const { getAdminChatIds, getMykolayChatId } = await import('@/lib/direct-reminders/telegram');
    const { listRegisteredChats } = await import('@/lib/photo-reports/master-registry');
    const { TELEGRAM_ENV } = await import('@/lib/telegram/env');

    // Отримуємо chat ID для mykolay007
    let mykolayChatId = await getMykolayChatId();
    if (!mykolayChatId) {
      const registeredChats = await listRegisteredChats();
      const mykolayChat = registeredChats.find(
        chat => {
          const username = chat.username?.toLowerCase().replace('@', '') || '';
          return username === 'mykolay007';
        }
      );
      mykolayChatId = mykolayChat?.chatId;
    }

    // Отримуємо chat ID адміністраторів
    const adminChatIds = await getAdminChatIds();
    const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;

    const results = {
      totalClients: clientsWithoutInstagram.length,
      sent: 0,
      failed: 0,
      errors: [] as string[],
      clients: [] as any[],
    };

    // Відправляємо повідомлення для кожного клієнта
    for (const client of clientsWithoutInstagram) {
      try {
        const clientName = [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Невідомий клієнт';
        const clientPhone = 'не вказано'; // У клієнта немає phone в базі
        const altegioClientId = client.altegioClientId || 'не вказано';
        
        const message = `⚠️ <b>Відсутній Instagram username</b>\n\n` +
          `Клієнт: <b>${clientName}</b>\n` +
          `Instagram: ${client.instagramUsername}\n` +
          `Altegio ID: <code>${altegioClientId}</code>\n\n` +
          `📝 <b>Відправте Instagram username у відповідь на це повідомлення</b>\n` +
          `(наприклад: @username або username)\n\n` +
          `Або додайте Instagram username для цього клієнта в Altegio.`;

        let sentToMykolay = false;
        let sentToAdmins = 0;

        // Відправляємо mykolay007
        if (mykolayChatId) {
          try {
            await sendMessage(mykolayChatId, message, {}, botToken);
            sentToMykolay = true;
            console.log(`[direct/send-missing-instagram-notifications] ✅ Sent notification to mykolay007 for client ${client.id}`);
          } catch (err) {
            console.error(`[direct/send-missing-instagram-notifications] ❌ Failed to send to mykolay007:`, err);
          }
        }

        // Відправляємо адміністраторам
        for (const adminChatId of adminChatIds) {
          try {
            await sendMessage(adminChatId, message, {}, botToken);
            sentToAdmins++;
            console.log(`[direct/send-missing-instagram-notifications] ✅ Sent notification to admin ${adminChatId} for client ${client.id}`);
          } catch (err) {
            console.error(`[direct/send-missing-instagram-notifications] ❌ Failed to send to admin ${adminChatId}:`, err);
          }
        }

        if (sentToMykolay || sentToAdmins > 0) {
          results.sent++;
          results.clients.push({
            id: client.id,
            name: clientName,
            instagramUsername: client.instagramUsername,
            altegioClientId: altegioClientId,
            sentToMykolay,
            sentToAdmins,
          });
        } else {
          results.failed++;
          results.errors.push(`Failed to send for client ${client.id}: no recipients available`);
        }
      } catch (err) {
        results.failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`Client ${client.id}: ${errorMsg}`);
        console.error(`[direct/send-missing-instagram-notifications] Error processing client ${client.id}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Sent notifications for ${results.sent} clients`,
      ...results,
    });
  } catch (error) {
    console.error('[direct/send-missing-instagram-notifications] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

