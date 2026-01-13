// web/app/api/admin/direct/sync-telegram-notification-sent/route.ts
// Синхронізація telegramNotificationSent для клієнтів з missing_instagram_*

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { prisma } from '@/lib/prisma';
import { kvRead } from '@/lib/kv';

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
 * POST - синхронізувати telegramNotificationSent для клієнтів з missing_instagram_*
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[direct/sync-telegram-notification-sent] Starting sync for missing_instagram_ clients`);

    // Отримуємо всіх клієнтів
    const allClients = await getAllDirectClients();
    
    // Фільтруємо клієнтів з missing_instagram_*
    const missingInstagramClients = allClients.filter(client => 
      client.instagramUsername?.startsWith('missing_instagram_')
    );

    console.log(`[direct/sync-telegram-notification-sent] Found ${missingInstagramClients.length} clients with missing_instagram_*`);

    // Отримуємо лог Telegram повідомлень
    const telegramLogItems = await kvRead.lrange('telegram:direct-reminders:log', 0, 9999);
    const telegramLogs = telegramLogItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    console.log(`[direct/sync-telegram-notification-sent] Found ${telegramLogs.length} Telegram log entries`);

    // Отримуємо лог вихідних повідомлень про відсутній Instagram
    const outgoingLogItems = await kvRead.lrange('telegram:missing-instagram:outgoing', 0, 9999);
    const outgoingLogs = outgoingLogItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    console.log(`[direct/sync-telegram-notification-sent] Found ${outgoingLogs.length} outgoing message log entries`);

    // Створюємо мапу Altegio ID -> чи було відправлено повідомлення
    const notificationSentMap = new Map<number, boolean>();

    // Перевіряємо лог вихідних повідомлень - це найточніший спосіб визначити, які повідомлення були відправлені
    for (const logEntry of outgoingLogs) {
      if (logEntry.type === 'outgoing' || logEntry.direction === 'outgoing') {
        const altegioId = logEntry.altegioClientId;
        if (altegioId && typeof altegioId === 'number') {
          notificationSentMap.set(altegioId, true);
          console.log(`[direct/sync-telegram-notification-sent] Found outgoing message for Altegio ID ${altegioId} (sent at ${logEntry.sentAt})`);
        }
      }
    }

    // ДОДАТКОВО: Перевіряємо Telegram лог на наявність відповідей на повідомлення про відсутній Instagram
    // Якщо є відповідь, це також підтверджує, що повідомлення було відправлено
    for (const logEntry of telegramLogs) {
      const replyText = logEntry.replyToMessageText || '';
      if (replyText && replyText.includes('Відсутній Instagram username') && replyText.includes('Altegio ID:')) {
        // Витягуємо Altegio ID з повідомлення, на яке була відповідь
        const altegioIdMatch = replyText.match(/Altegio ID[:\s]+<code>(\d+)<\/code>|Altegio ID[:\s]+(\d+)/i);
        if (altegioIdMatch) {
          const altegioId = parseInt(altegioIdMatch[1] || altegioIdMatch[2], 10);
          if (!isNaN(altegioId)) {
            notificationSentMap.set(altegioId, true);
            console.log(`[direct/sync-telegram-notification-sent] Found reply for Altegio ID ${altegioId} - message was sent`);
          }
        }
      }
    }

    console.log(`[direct/sync-telegram-notification-sent] Found ${notificationSentMap.size} clients with confirmed sent notifications (from outgoing logs and replies)`);

    // Оновлюємо клієнтів
    const results = {
      total: missingInstagramClients.length,
      updated: 0,
      alreadySet: 0,
      noAltegioId: 0,
      notFoundInLogs: 0,
      errors: 0,
      details: [] as Array<{
        clientId: string;
        instagramUsername: string;
        altegioClientId?: number;
        status: string;
      }>,
    };

    for (const client of missingInstagramClients) {
      try {
        // Витягуємо Altegio ID з username, якщо можливо
        const missingIdMatch = client.instagramUsername?.match(/^missing_instagram_(\d+)$/);
        const altegioClientId = client.altegioClientId || (missingIdMatch ? parseInt(missingIdMatch[1], 10) : undefined);

        if (!altegioClientId) {
          results.noAltegioId++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername || '',
            status: 'no_altegio_id',
          });
          continue;
        }

        // Перевіряємо, чи було відправлено повідомлення
        const wasNotificationSent = notificationSentMap.has(altegioClientId);

        // Перевіряємо поточний стан
        const currentClient = await prisma.directClient.findUnique({
          where: { id: client.id },
          select: { telegramNotificationSent: true },
        });

        if (currentClient?.telegramNotificationSent) {
          results.alreadySet++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername || '',
            altegioClientId,
            status: 'already_set',
          });
          continue;
        }

        if (wasNotificationSent) {
          // Оновлюємо клієнта
          await prisma.directClient.update({
            where: { id: client.id },
            data: { telegramNotificationSent: true },
          });
          results.updated++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername || '',
            altegioClientId,
            status: 'updated',
          });
          console.log(`[direct/sync-telegram-notification-sent] ✅ Updated client ${client.id} (Altegio ID: ${altegioClientId})`);
        } else {
          results.notFoundInLogs++;
          results.details.push({
            clientId: client.id,
            instagramUsername: client.instagramUsername || '',
            altegioClientId,
            status: 'not_found_in_logs',
          });
        }
      } catch (err) {
        results.errors++;
        console.error(`[direct/sync-telegram-notification-sent] ❌ Error processing client ${client.id}:`, err);
        results.details.push({
          clientId: client.id,
          instagramUsername: client.instagramUsername || '',
          status: 'error',
        });
      }
    }

    console.log(`[direct/sync-telegram-notification-sent] ✅ Sync completed:`, results);

    return NextResponse.json({
      ok: true,
      message: `Синхронізація завершена`,
      results,
    });
  } catch (error) {
    console.error(`[direct/sync-telegram-notification-sent] ❌ Error:`, error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
