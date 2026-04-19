// web/app/api/admin/direct/sync-missing-instagram/route.ts
// Обробка всіх вебхуків від Altegio, які не мають Instagram username
// Разова початкова дія для заповнення бази клієнтами без Instagram

import { NextRequest, NextResponse } from 'next/server';
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
 * POST - обробити всі вебхуки від Altegio, які не мають Instagram username
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[direct/sync-missing-instagram] Processing all webhooks for clients without Instagram`);

    // Отримуємо всі вебхуки з логу (можна збільшити ліміт, якщо потрібно)
    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, 9999);
    const events = rawItems
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

    // Фільтруємо вебхуки, які стосуються клієнтів або записів
    const allEvents = events.filter((e: any) => {
      const isClientEvent = e.body?.resource === 'client' && (e.body?.status === 'create' || e.body?.status === 'update');
      const isRecordEvent = e.body?.resource === 'record' && (e.body?.status === 'create' || e.body?.status === 'update');
      return isClientEvent || isRecordEvent;
    });

    console.log(`[direct/sync-missing-instagram] Found ${allEvents.length} events total (client + record)`);

    // Імпортуємо функції для обробки вебхуків
    const { getAllDirectClients, getAllDirectStatuses, saveDirectClient, getDirectClientByAltegioId } = await import('@/lib/direct-store');
    const { normalizeInstagram } = await import('@/lib/normalize');

    // Отримуємо існуючих клієнтів
    const existingDirectClients = await getAllDirectClients();
    const existingInstagramMap = new Map<string, string>();
    const existingAltegioIdMap = new Map<number, string>();
    
    for (const dc of existingDirectClients) {
      const normalized = normalizeInstagram(dc.instagramUsername);
      if (normalized) {
        existingInstagramMap.set(normalized, dc.id);
      }
      if (dc.altegioClientId) {
        existingAltegioIdMap.set(dc.altegioClientId, dc.id);
      }
    }

    // Отримуємо статус за замовчуванням
    const allStatuses = await getAllDirectStatuses();
    const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
    if (!defaultStatus) {
      return NextResponse.json({
        ok: false,
        error: 'No default status found',
      }, { status: 500 });
    }

    const results = {
      totalEvents: allEvents.length,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      skippedAlreadyExists: 0,
      errors: [] as string[],
      clients: [] as any[],
    };

    // Обробляємо кожен вебхук
    for (const event of allEvents) {
      try {
        // Для record events клієнт знаходиться в data.client
        // Для client events клієнт знаходиться в data або data.client
        const isRecordEvent = event.body?.resource === 'record';
        const clientId = isRecordEvent 
          ? (event.body?.data?.client?.id || event.body?.data?.client_id)
          : event.body?.resource_id;
        const client = isRecordEvent
          ? event.body?.data?.client
          : (event.body?.data?.client || event.body?.data);

        if (!clientId || !client) {
          results.skipped++;
          continue;
        }

        const altegioClientId = parseInt(String(clientId), 10);

        // Перевіряємо, чи вже існує клієнт з таким altegioClientId
        const existingClientByAltegioId = await getDirectClientByAltegioId(altegioClientId);
        if (existingClientByAltegioId) {
          // Якщо клієнт вже існує і має нормальний Instagram (не тимчасовий), пропускаємо
          if (!existingClientByAltegioId.instagramUsername.startsWith('missing_instagram_')) {
            results.skippedAlreadyExists++;
            continue;
          }
        }

        // Витягуємо Instagram username
        let instagram: string | null = null;
        
        if (client.custom_fields) {
          if (Array.isArray(client.custom_fields)) {
            for (const field of client.custom_fields) {
              if (field && typeof field === 'object') {
                const title = field.title || field.name || field.label || '';
                const value = field.value || field.data || field.content || field.text || '';
                if (value && typeof value === 'string' && /instagram/i.test(title)) {
                  instagram = value.trim();
                  break;
                }
              }
            }
          } else if (typeof client.custom_fields === 'object') {
            for (const [key, value] of Object.entries(client.custom_fields)) {
              if (value && typeof value === 'string' && /instagram/i.test(key)) {
                instagram = value.trim();
                break;
              }
            }
          }
        }

        // Перевіряємо, чи Instagram валідний (не "no/ні", не порожній, не null)
        const invalidValues = ['no', 'ні', 'none', 'null', 'undefined', '', 'n/a', 'немає', 'нема'];
        const originalInstagram = instagram; // Зберігаємо оригінальне значення для перевірки повідомлень
        const isExplicitNoInstagram = !!originalInstagram && ['no', 'ні'].includes(originalInstagram.toLowerCase().trim());
        if (instagram) {
          const lowerInstagram = instagram.toLowerCase().trim();
          if (invalidValues.includes(lowerInstagram)) {
            instagram = null; // Вважаємо Instagram відсутнім
          } else {
            const normalized = normalizeInstagram(instagram);
            if (normalized) {
              // Якщо є валідний Instagram, пропускаємо (ми шукаємо тільки тих, хто не має Instagram)
              results.skipped++;
              continue;
            }
          }
        }

        // Якщо немає Instagram, створюємо/оновлюємо клієнта зі станом "client"
        const normalizedInstagram = isExplicitNoInstagram ? `no_instagram_${clientId}` : `missing_instagram_${clientId}`;
        const shouldSendNotification = !isExplicitNoInstagram;

        // Витягуємо ім'я
        const nameParts = (client.name || client.display_name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

        // Шукаємо існуючого клієнта
        let existingClientId = existingAltegioIdMap.get(altegioClientId);

        if (existingClientId) {
          // Оновлюємо існуючого клієнта
          const { getDirectClient } = await import('@/lib/direct-store');
          const existingClient = await getDirectClient(existingClientId);
          if (existingClient) {
            const updated = {
              ...existingClient,
              altegioClientId: altegioClientId,
              instagramUsername: normalizedInstagram,
              // Altegio клієнт: тримаємо базовий стан "client" (а не "lead")
              state: 'client' as const,
              ...(firstName && { firstName }),
              ...(lastName && { lastName }),
              updatedAt: new Date().toISOString(),
            };
            await saveDirectClient(updated, 'sync-missing-instagram', { altegioClientId }, { touchUpdatedAt: false });
            results.updated++;
            results.clients.push({
              id: updated.id,
              instagramUsername: normalizedInstagram,
              firstName,
              lastName,
              altegioClientId: clientId,
              action: 'updated',
              state: 'client',
            });
          }
        } else {
          // Створюємо нового клієнта
          const now = new Date().toISOString();
          // Клієнти з Altegio завжди мають стан "client" (не можуть бути "lead")
          const newClient = {
            id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            source: 'instagram' as const,
            state: 'client' as const,
            firstContactDate: now,
            includeInNewLeadsKpi: false,
            statusId: defaultStatus.id,
            visitedSalon: false,
            signedUpForPaidService: false,
            altegioClientId: altegioClientId,
            createdAt: now,
            updatedAt: now,
          };
          await saveDirectClient(newClient, 'sync-missing-instagram', { altegioClientId }, { touchUpdatedAt: false });
          results.created++;
          results.clients.push({
            id: newClient.id,
            instagramUsername: normalizedInstagram,
            firstName,
            lastName,
            altegioClientId: clientId,
            action: 'created',
            state: 'client',
          });
          
          // Відправляємо повідомлення тільки якщо Instagram не був явно встановлений в "no"
          if (shouldSendNotification) {
            try {
              const { sendMessage } = await import('@/lib/telegram/api');
              const { getAdminChatIds, getMykolayChatId } = await import('@/lib/direct-reminders/telegram');
              const { listRegisteredChats } = await import('@/lib/photo-reports/master-registry');
              const { TELEGRAM_ENV } = await import('@/lib/telegram/env');

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

              const adminChatIds = await getAdminChatIds();
              // Виключаємо mykolayChatId з adminChatIds, щоб не дублювати повідомлення
              const uniqueAdminChatIds = adminChatIds.filter(id => id !== mykolayChatId);
              const clientName = (client.name || client.display_name || '').trim();
              
              // Перевіряємо, чи є ім'я (не відправляємо для клієнтів без імені)
              // Перевіряємо різні варіанти "невідомого" імені
              const clientNameLower = clientName.toLowerCase();
              const isUnknownName = 
                !clientName || 
                clientName === 'Невідоме ім\'я' || 
                clientName === 'Невідомий клієнт' ||
                clientNameLower === 'невідоме ім\'я' ||
                clientNameLower === 'невідомий клієнт' ||
                clientNameLower.startsWith('невідом') ||
                clientNameLower === 'unknown' ||
                clientNameLower === 'немає імені';
              
              if (isUnknownName) {
                console.log(`[direct/sync-missing-instagram] ⏭️ Skipping notification for client ${clientId} - no name provided (name: "${clientName}")`);
              } else {
                const clientPhone = client.phone || 'не вказано';
                const message = `⚠️ <b>Відсутній Instagram username</b>\n\n` +
                  `Клієнт: <b>${clientName}</b>\n` +
                  `Телефон: ${clientPhone}\n` +
                  `Altegio ID: <code>${clientId}</code>\n\n` +
                  `📝 <b>Відправте Instagram username у відповідь на це повідомлення</b>\n` +
                  `(наприклад: @username або username)\n\n` +
                  `Або додайте Instagram username для цього клієнта в Altegio.`;

                const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;

                if (mykolayChatId) {
                  try {
                    await sendMessage(mykolayChatId, message, {}, botToken);
                    console.log(`[direct/sync-missing-instagram] ✅ Sent missing Instagram notification to mykolay007 (chatId: ${mykolayChatId})`);
                    
                    // Логуємо вихідне повідомлення в KV
                    try {
                      const { kvWrite } = await import('@/lib/kv');
                      const logEntry = {
                        type: 'outgoing',
                        direction: 'outgoing',
                        sentAt: new Date().toISOString(),
                        chatId: mykolayChatId,
                        altegioClientId: clientId,
                        clientName: clientName,
                        message: message,
                        source: 'sync-missing-instagram',
                      };
                      await kvWrite.lpush('telegram:missing-instagram:outgoing', JSON.stringify(logEntry));
                      await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
                    } catch (logErr) {
                      console.error(`[direct/sync-missing-instagram] Failed to log outgoing message:`, logErr);
                    }
                  } catch (err) {
                    console.error(`[direct/sync-missing-instagram] ❌ Failed to send notification to mykolay007:`, err);
                  }
                }

                // Відправляємо адміністраторам (без mykolayChatId, щоб не дублювати)
                for (const adminChatId of uniqueAdminChatIds) {
                  try {
                    await sendMessage(adminChatId, message, {}, botToken);
                    console.log(`[direct/sync-missing-instagram] ✅ Sent missing Instagram notification to admin (chatId: ${adminChatId})`);
                    
                    // Логуємо вихідне повідомлення в KV
                    try {
                      const { kvWrite } = await import('@/lib/kv');
                      const logEntry = {
                        type: 'outgoing',
                        direction: 'outgoing',
                        sentAt: new Date().toISOString(),
                        chatId: adminChatId,
                        altegioClientId: clientId,
                        clientName: clientName,
                        message: message,
                        source: 'sync-missing-instagram',
                      };
                      await kvWrite.lpush('telegram:missing-instagram:outgoing', JSON.stringify(logEntry));
                      await kvWrite.ltrim('telegram:missing-instagram:outgoing', 0, 9999);
                    } catch (logErr) {
                      console.error(`[direct/sync-missing-instagram] Failed to log outgoing message:`, logErr);
                    }
                  } catch (err) {
                    console.error(`[direct/sync-missing-instagram] ❌ Failed to send notification to admin ${adminChatId}:`, err);
                  }
                }
              }
            } catch (notificationErr) {
              console.error(`[direct/sync-missing-instagram] ❌ Failed to send missing Instagram notifications:`, notificationErr);
            }
          } else if (['no', 'ні'].includes((originalInstagram || '').toLowerCase().trim())) {
            console.log(`[direct/sync-missing-instagram] ⏭️ Skipping notification for client ${clientId} - Instagram explicitly set to "no/ні"`);
          }
        }

        results.processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(errorMsg);
        console.error(`[direct/sync-missing-instagram] Error processing event:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Processed all webhooks for clients without Instagram',
      ...results,
    });
  } catch (error) {
    console.error('[direct/sync-missing-instagram] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

