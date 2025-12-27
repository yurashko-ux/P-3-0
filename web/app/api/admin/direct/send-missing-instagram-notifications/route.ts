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
    // Але виключаємо тих, де Instagram = "no" (це означає, що у клієнтки немає Instagram)
    // Також виключаємо тих, у кого немає імені (немає по чому ідентифікувати)
    const clientsWithoutInstagram = allClients.filter(client => {
      const hasNoInstagramState = client.state === 'no-instagram';
      const hasMissingInstagramUsername = client.instagramUsername?.startsWith('missing_instagram_');
      
      // Перевіряємо, чи Instagram не був явно встановлений в "no"
      // Витягуємо altegioClientId з username, якщо це missing_instagram_{id}
      const missingIdMatch = client.instagramUsername?.match(/^missing_instagram_(\d+)$/);
      // Якщо це не missing_instagram_ формат, пропускаємо
      if (!hasNoInstagramState && !hasMissingInstagramUsername) {
        return false;
      }
      
      // Перевіряємо, чи є ім'я
      const clientName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
      // Перевіряємо також окремо firstName і lastName, бо "Невідоме ім'я" може бути розбите на частини
      const firstNameLower = (client.firstName || '').toLowerCase().trim();
      const lastNameLower = (client.lastName || '').toLowerCase().trim();
      const isUnknownName = 
        !clientName || 
        clientName === 'Невідоме ім\'я' || 
        clientName === 'Невідомий клієнт' ||
        (firstNameLower === 'невідоме' && lastNameLower === 'ім\'я') ||
        (firstNameLower === 'невідоме' && !lastNameLower) ||
        (!firstNameLower && !lastNameLower);
      
      if (isUnknownName) {
        console.log(`[direct/send-missing-instagram-notifications] ⏭️ Skipping client ${client.id} - no name provided (firstName: "${client.firstName}", lastName: "${client.lastName}")`);
        return false;
      }
      
      return true;
    });

    console.log(`[direct/send-missing-instagram-notifications] Found ${clientsWithoutInstagram.length} clients without Instagram (after filtering)`);

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
    // Виключаємо mykolayChatId з adminChatIds, щоб не дублювати повідомлення
    const uniqueAdminChatIds = adminChatIds.filter(id => id !== mykolayChatId);
    const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;

    // Імпортуємо KV store для перевірки оригінального значення Instagram
    const { kvRead } = await import('@/lib/kv');

    const results = {
      totalClients: clientsWithoutInstagram.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
      clients: [] as any[],
    };

    // Функція для перевірки, чи був Instagram = "no" в останньому webhook
    async function wasInstagramSetToNo(altegioClientId: number | undefined): Promise<boolean> {
      if (!altegioClientId) return false;
      
      try {
        // Отримуємо останні webhook події
        const webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 999);
        const webhooks = webhookLogRaw
          .map((raw: string) => {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
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

        // Шукаємо останній (найновіший) webhook для цього клієнта
        // Сортуємо webhooks по receivedAt (найновіші спочатку)
        const sortedWebhooks = webhooks
          .filter(w => w.receivedAt)
          .sort((a, b) => {
            const dateA = new Date(a.receivedAt).getTime();
            const dateB = new Date(b.receivedAt).getTime();
            return dateB - dateA; // Найновіші спочатку
          });
        
        for (const webhook of sortedWebhooks) {
          const body = webhook.body || webhook;
          const resource = body.resource;
          const data = body.data || {};
          
          let clientId: number | null = null;
          let instagram: string | null = null;
          
          if (resource === 'client') {
            clientId = body.resource_id || data.id;
            const client = data.client || data;
            if (client?.custom_fields) {
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
          } else if (resource === 'record') {
            const recordClient = data.client;
            if (recordClient?.id) {
              clientId = recordClient.id;
              if (recordClient.custom_fields) {
                if (Array.isArray(recordClient.custom_fields)) {
                  for (const field of recordClient.custom_fields) {
                    if (field && typeof field === 'object') {
                      const title = field.title || field.name || field.label || '';
                      const value = field.value || field.data || field.content || field.text || '';
                      if (value && typeof value === 'string' && /instagram/i.test(title)) {
                        instagram = value.trim();
                        break;
                      }
                    }
                  }
                } else if (typeof recordClient.custom_fields === 'object') {
                  for (const [key, value] of Object.entries(recordClient.custom_fields)) {
                    if (value && typeof value === 'string' && /instagram/i.test(key)) {
                      instagram = value.trim();
                      break;
                    }
                  }
                }
              }
            }
          }
          
          if (clientId && parseInt(String(clientId), 10) === parseInt(String(altegioClientId), 10)) {
            // Знайшли webhook для цього клієнта - перевіряємо Instagram
            // Якщо Instagram = "no", повертаємо true
            if (instagram && instagram.toLowerCase().trim() === 'no') {
              return true;
            }
            // Якщо знайшли webhook для цього клієнта і Instagram вказано (не "no"), повертаємо false
            // Якщо Instagram не вказано взагалі, продовжуємо пошук (можливо, в старіших webhooks було "no")
            if (instagram !== null) {
              return false;
            }
          }
        }
      } catch (err) {
        console.error(`[direct/send-missing-instagram-notifications] Error checking Instagram "no" for client ${altegioClientId}:`, err);
      }
      
      return false;
    }

    // Відправляємо повідомлення для кожного клієнта
    for (const client of clientsWithoutInstagram) {
      try {
        const clientName = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
        
        // Додаткова перевірка: якщо ім'я відсутнє або невідоме - пропускаємо
        // Перевіряємо також окремо firstName і lastName, бо "Невідоме ім'я" може бути розбите на частини
        const firstNameLower = (client.firstName || '').toLowerCase().trim();
        const lastNameLower = (client.lastName || '').toLowerCase().trim();
        const isUnknownName = 
          !clientName || 
          clientName === 'Невідоме ім\'я' || 
          clientName === 'Невідомий клієнт' ||
          (firstNameLower === 'невідоме' && lastNameLower === 'ім\'я') ||
          (firstNameLower === 'невідоме' && !lastNameLower) ||
          (!firstNameLower && !lastNameLower);
        
        if (isUnknownName) {
          console.log(`[direct/send-missing-instagram-notifications] ⏭️ Skipping client ${client.id} - no name provided (additional check, firstName: "${client.firstName}", lastName: "${client.lastName}")`);
          results.skipped = (results.skipped || 0) + 1;
          continue;
        }
        
        const clientPhone = 'не вказано'; // У клієнта немає phone в базі
        const altegioClientId = client.altegioClientId;
        
        // Перевіряємо, чи був Instagram = "no" в останньому webhook
        if (altegioClientId) {
          const wasNo = await wasInstagramSetToNo(altegioClientId);
          if (wasNo) {
            console.log(`[direct/send-missing-instagram-notifications] ⏭️ Skipping client ${client.id} (Altegio ID: ${altegioClientId}) - Instagram was explicitly set to "no"`);
            results.skipped = (results.skipped || 0) + 1;
            continue;
          }
        }
        
        const message = `⚠️ <b>Відсутній Instagram username</b>\n\n` +
          `Клієнт: <b>${clientName}</b>\n` +
          `Instagram: ${client.instagramUsername}\n` +
          `Altegio ID: <code>${altegioClientId || 'не вказано'}</code>\n\n` +
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

        // Відправляємо адміністраторам (без mykolayChatId, щоб не дублювати)
        for (const adminChatId of uniqueAdminChatIds) {
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

