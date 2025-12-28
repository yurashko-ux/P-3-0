// web/app/api/telegram/direct-reminders-webhook/route.ts
// Webhook endpoint для нового бота нагадувань Direct клієнтів

import { NextRequest, NextResponse } from "next/server";
import { assertDirectRemindersBotToken, TELEGRAM_ENV } from "@/lib/telegram/env";
import { TelegramUpdate } from "@/lib/telegram/types";
import {
  answerCallbackQuery,
  sendMessage,
  editMessageText,
} from "@/lib/telegram/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Отримує токен бота для нагадувань Direct клієнтів (HOB_client_bot)
 */
function getDirectRemindersBotToken(): string {
  return TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
}

/**
 * Обробка оновлення Instagram username
 */
async function processInstagramUpdate(chatId: number, altegioClientId: number, instagramText: string) {
  try {
    console.log(`[direct-reminders-webhook] 🔄 processInstagramUpdate: chatId=${chatId}, altegioClientId=${altegioClientId}, instagramText="${instagramText}"`);
    
    const { updateInstagramForAltegioClient, getDirectClientByAltegioId } = await import('@/lib/direct-store');
    const { normalizeInstagram } = await import('@/lib/normalize');
    
    // Спочатку перевіряємо, чи існує клієнт з таким Altegio ID
    const existingClient = await getDirectClientByAltegioId(altegioClientId);
    console.log(`[direct-reminders-webhook] 🔍 Client lookup by Altegio ID ${altegioClientId}:`, existingClient ? {
      id: existingClient.id,
      instagramUsername: existingClient.instagramUsername,
      state: existingClient.state,
    } : 'NOT FOUND');
    
    if (!existingClient) {
      const botToken = getDirectRemindersBotToken();
      await sendMessage(
        chatId,
        `❌ Клієнт з Altegio ID ${altegioClientId} не знайдено в базі даних.\n\nМожливо, клієнт ще не був синхронізований з Altegio. Спробуйте пізніше або перевірте, чи правильно вказано Altegio ID.`,
        {},
        botToken
      );
      return;
    }
    
    // Витягуємо Instagram username (може бути з @ або без)
    const cleanInstagram = instagramText.trim().replace(/^@/, '').split(/\s+/)[0];
    console.log(`[direct-reminders-webhook] Clean Instagram text: "${cleanInstagram}"`);
    
    const normalized = normalizeInstagram(cleanInstagram);
    console.log(`[direct-reminders-webhook] Normalized Instagram: "${normalized}"`);
    
    if (!normalized) {
      const botToken = getDirectRemindersBotToken();
      await sendMessage(
        chatId,
        `❌ Невірний формат Instagram username. Будь ласка, введіть правильний username (наприклад: username або @username).`,
        {},
        botToken
      );
      return;
    }
    
    const botToken = getDirectRemindersBotToken();
    console.log(`[direct-reminders-webhook] 📞 Calling updateInstagramForAltegioClient(${altegioClientId}, "${normalized}")`);
    const updatedClient = await updateInstagramForAltegioClient(altegioClientId, normalized);
    console.log(`[direct-reminders-webhook] ✅ Update result:`, updatedClient ? {
      success: true,
      clientId: updatedClient.id,
      instagramUsername: updatedClient.instagramUsername,
      state: updatedClient.state,
      altegioClientId: updatedClient.altegioClientId,
    } : { success: false, reason: 'updateInstagramForAltegioClient returned null' });
    
    if (updatedClient) {
      await sendMessage(
        chatId,
        `✅ Instagram username оновлено!\n\n` +
        `Altegio ID: ${altegioClientId}\n` +
        `Instagram: ${normalized}\n\n` +
        `Тепер всі вебхуки для цього клієнта будуть оброблятися правильно.`,
        {},
        botToken
      );
      console.log(`[direct-reminders-webhook] ✅ Updated Instagram for Altegio client ${altegioClientId} to ${normalized}`);
    } else {
      await sendMessage(
        chatId,
        `❌ Не вдалося оновити Instagram username. Перевірте, чи існує клієнт з Altegio ID ${altegioClientId}.`,
        {},
        botToken
      );
      console.error(`[direct-reminders-webhook] ❌ Failed to update Instagram - client not found or update failed`);
    }
  } catch (err) {
    console.error(`[direct-reminders-webhook] Failed to update Instagram for Altegio client ${altegioClientId}:`, err);
    const botToken = getDirectRemindersBotToken();
    await sendMessage(
      chatId,
      `❌ Помилка при оновленні Instagram username: ${err instanceof Error ? err.message : String(err)}`,
      {},
      botToken
    );
  }
}

/**
 * Обробка callback для вибору майстра
 */
async function handleChangeMasterCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  reminderId: string
) {
  try {
    console.log(`[direct-reminders-webhook] Handling change master callback for reminder ${reminderId}`);
    
    const { getDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getDirectMastersForSelection } = await import('@/lib/direct-masters/store');
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      console.warn(`[direct-reminders-webhook] Reminder ${reminderId} not found`);
      const botToken = getDirectRemindersBotToken();
      await answerCallbackQuery(callback.id, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    // Отримуємо відповідальних з бази даних (вже відфільтровані)
    const masters = await getDirectMastersForSelection();
    console.log(`[direct-reminders-webhook] Found ${masters.length} masters from database`);
    
    const botToken = getDirectRemindersBotToken();
    
    if (masters.length === 0) {
      await answerCallbackQuery(callback.id, {
        text: 'Відповідальних не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (!chatId || !messageId) {
      console.error(`[direct-reminders-webhook] Missing chatId or messageId: chatId=${chatId}, messageId=${messageId}`);
      await answerCallbackQuery(callback.id, {
        text: 'Помилка: не вдалося отримати дані повідомлення',
        show_alert: true,
      }, botToken);
      return;
    }

    // Створюємо кнопки з майстрами (по 2 в рядку)
    const masterButtons: any[][] = [];
    for (let i = 0; i < masters.length; i += 2) {
      const row = masters.slice(i, i + 2).map(master => ({
        text: `👤 ${master.name}`,
        callback_data: `direct_reminder:${reminderId}:select-master-${master.id}`,
      }));
      masterButtons.push(row);
    }
    
    // Додаємо кнопку "Назад"
    masterButtons.push([
      { text: '◀️ Назад', callback_data: `direct_reminder:${reminderId}:back` },
    ]);

    const keyboard = {
      inline_keyboard: masterButtons,
    };

    // Отримуємо текст повідомлення (може бути в text або caption)
    const messageText = callback.message?.text || callback.message?.caption || '';

    console.log(`[direct-reminders-webhook] Updating message ${messageId} in chat ${chatId} with ${masters.length} masters`);

    // Оновлюємо повідомлення з кнопками майстрів
    await editMessageText(chatId, messageId, messageText, {
      reply_markup: keyboard,
    }, botToken);

    await answerCallbackQuery(callback.id, {
      text: `Оберіть відповідального (${masters.length} доступно)`,
    }, botToken);
    
    console.log(`[direct-reminders-webhook] ✅ Successfully updated message with master selection`);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle change master callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: `Помилка обробки вибору майстра: ${err instanceof Error ? err.message : String(err)}`,
      show_alert: true,
    }, botToken);
  }
}

/**
 * Обробка вибору конкретного майстра
 */
async function handleSelectMasterCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  reminderId: string,
  masterId: string
) {
  try {
    const { getDirectReminder, saveDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getAllDirectClients, saveDirectClient } = await import('@/lib/direct-store');
    const { getDirectMasterById } = await import('@/lib/direct-masters/store');
    
    const botToken = getDirectRemindersBotToken();
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      await answerCallbackQuery(callback.id, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    const master = await getDirectMasterById(masterId);
    if (!master) {
      await answerCallbackQuery(callback.id, {
        text: 'Відповідального не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    // Оновлюємо майстра клієнта
    const directClients = await getAllDirectClients();
    const directClient = directClients.find(c => c.id === reminder.directClientId);
    
    if (directClient) {
      const updated: typeof directClient = {
        ...directClient,
        masterId: master.id,
        updatedAt: new Date().toISOString(),
      };
      await saveDirectClient(updated);
      console.log(`[direct-reminders-webhook] ✅ Updated Direct client ${directClient.id} master to '${master.name}' (${master.id}) from reminder ${reminderId}`);
    }

    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (chatId && messageId) {
      // Повертаємо оригінальні кнопки
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Все чудово', callback_data: `direct_reminder:${reminderId}:all-good` },
            { text: '💰 За дорого', callback_data: `direct_reminder:${reminderId}:too-expensive` },
          ],
          [
            { text: '📞 Недодзвон', callback_data: `direct_reminder:${reminderId}:no-call` },
            { text: '👤 Заміна відповідального', callback_data: `direct_reminder:${reminderId}:change-master` },
          ],
        ],
      };

      await editMessageText(chatId, messageId, callback.message?.text || '', {
        reply_markup: keyboard,
      }, botToken);
    }

    await answerCallbackQuery(callback.id, {
      text: `✅ Відповідального змінено на: ${master.name}`,
    }, botToken);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle select master callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: 'Помилка обробки вибору майстра',
      show_alert: true,
    }, botToken);
  }
}

/**
 * Обробка кнопки "Назад" - повертає оригінальні кнопки
 */
async function handleBackCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  reminderId: string
) {
  try {
    const botToken = getDirectRemindersBotToken();
    
    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (!chatId || !messageId) {
      await answerCallbackQuery(callback.id, {
        text: 'Помилка: не вдалося отримати дані повідомлення',
        show_alert: true,
      }, botToken);
      return;
    }

    // Повертаємо оригінальні кнопки
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Все чудово', callback_data: `direct_reminder:${reminderId}:all-good` },
          { text: '💰 За дорого', callback_data: `direct_reminder:${reminderId}:too-expensive` },
        ],
        [
          { text: '📞 Недодзвон', callback_data: `direct_reminder:${reminderId}:no-call` },
          { text: '👤 Заміна відповідального', callback_data: `direct_reminder:${reminderId}:change-master` },
        ],
      ],
    };

    await editMessageText(chatId, messageId, callback.message?.text || '', {
      reply_markup: keyboard,
    }, botToken);

    await answerCallbackQuery(callback.id, {
      text: 'Повернуто до головного меню',
    }, botToken);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle back callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: 'Помилка обробки',
      show_alert: true,
    }, botToken);
  }
}

/**
 * Обробка callback для Direct нагадувань
 */
async function handleDirectReminderCallback(
  callbackId: string,
  reminderId: string,
  status: 'all-good' | 'too-expensive' | 'no-call'
) {
  try {
    const { getDirectReminder, saveDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getAllDirectClients, saveDirectClient } = await import('@/lib/direct-store');
    
    const botToken = getDirectRemindersBotToken();
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      await answerCallbackQuery(callbackId, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    // Оновлюємо статус нагадування
    reminder.status = status;
    reminder.updatedAt = new Date().toISOString();
    
    if (status === 'all-good' || status === 'too-expensive') {
      reminder.status = status;
      // Оновлюємо стан клієнта в Direct Manager
      const directClients = await getAllDirectClients();
      const directClient = directClients.find(c => c.id === reminder.directClientId);
      
      if (directClient) {
        const clientState: 'all-good' | 'too-expensive' = status === 'all-good' ? 'all-good' : 'too-expensive';
        const updated: typeof directClient = {
          ...directClient,
          state: clientState,
          updatedAt: new Date().toISOString(),
        };
        await saveDirectClient(updated);
        console.log(`[direct-reminders-webhook] ✅ Updated Direct client ${directClient.id} state to '${clientState}' from reminder ${reminderId}`);
      }
      
      await answerCallbackQuery(callbackId, {
        text: status === 'all-good' ? '✅ Статус оновлено: Все чудово' : '💰 Статус оновлено: За дорого',
      }, botToken);
    } else if (status === 'no-call') {
      reminder.status = 'no-call';
      reminder.lastReminderAt = new Date().toISOString();
      // Наступне нагадування буде надіслано через 2 години (обробляється в cron)
      
      await answerCallbackQuery(callbackId, {
        text: '📞 Нагадування буде надіслано повторно через 2 години',
      }, botToken);
    }
    
    await saveDirectReminder(reminder);
    console.log(`[direct-reminders-webhook] ✅ Updated reminder ${reminderId} status to '${status}'`);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle Direct reminder callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callbackId, {
      text: 'Помилка обробки нагадування',
      show_alert: true,
    }, botToken);
  }
}

async function handleCallback(callback: NonNullable<TelegramUpdate["callback_query"]>) {
  const data = callback.data || "";
  const chatId = callback.message?.chat.id;

  if (!chatId) {
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: "Не вдалося обробити дію",
      show_alert: true,
    }, botToken);
    return;
  }

  // Обробка callback для Direct нагадувань
  if (data.startsWith('direct_reminder:')) {
    const parts = data.split(':');
    if (parts.length === 3) {
      const [, reminderId, action] = parts;
      
      // Обробка вибору майстра
      if (action === 'change-master') {
        await handleChangeMasterCallback(callback, reminderId);
        return;
      }
      
      // Обробка вибору конкретного майстра
      if (action.startsWith('select-master-')) {
        const masterId = action.replace('select-master-', '');
        await handleSelectMasterCallback(callback, reminderId, masterId);
        return;
      }
      
      // Обробка кнопки "Назад"
      if (action === 'back') {
        await handleBackCallback(callback, reminderId);
        return;
      }
      
      // Обробка стандартних статусів
      await handleDirectReminderCallback(callback.id, reminderId, action as 'all-good' | 'too-expensive' | 'no-call');
      return;
    }
  }

  // Якщо це не callback для Direct нагадувань - ігноруємо
  const botToken = getDirectRemindersBotToken();
  await answerCallbackQuery(callback.id, {
    text: 'Невідома дія',
  }, botToken);
}

async function handleMessage(message: TelegramUpdate["message"]) {
  console.log(`[direct-reminders-webhook] handleMessage: FUNCTION CALLED - VERSION 2025-12-28-1127`);
  try {
    console.log(`[direct-reminders-webhook] handleMessage: INSIDE TRY BLOCK - VERSION 2025-12-28-1127`);
    if (!message) {
      console.log(`[direct-reminders-webhook] handleMessage: message is null/undefined`);
      return;
    }
    console.log(`[direct-reminders-webhook] handleMessage: message exists, getting chatId`);
    const chatId = message.chat.id;
    const fromUser = message.from;
    console.log(`[direct-reminders-webhook] handleMessage STEP 1: chatId=${chatId}, hasText=${!!message.text}, hasReply=${!!message.reply_to_message}`);
    console.log(`[direct-reminders-webhook] handleMessage STEP 2: fromUsername=${fromUser?.username}, fromUserId=${fromUser?.id}`);
    console.log(`[direct-reminders-webhook] handleMessage STEP 3: before messageText assignment`);
    
    const messageText = message.text;
    console.log(`[direct-reminders-webhook] handleMessage STEP 4: messageText="${messageText}", type=${typeof messageText}, startsWith="/start"=${messageText?.startsWith("/start")}`);

    // Обробка команди /start - реєстрація та автоматичне оновлення chatId в DirectMaster
    if (messageText?.startsWith("/start")) {
      console.log(`[direct-reminders-webhook] 🔵 Processing /start command from chatId=${chatId}, username=${fromUser?.username}, userId=${fromUser?.id}`);
      console.log(`[direct-reminders-webhook] Full user object:`, JSON.stringify(fromUser, null, 2));
      
      try {
      const { getMasterByTelegramUsername, getAllDirectMasters, saveDirectMaster } = await import('@/lib/direct-masters/store');
      
      // Шукаємо майстра за Telegram username
      if (fromUser?.username) {
        console.log(`[direct-reminders-webhook] 🔍 Searching for master with username: "${fromUser.username}"`);
        const directMaster = await getMasterByTelegramUsername(fromUser.username);
        console.log(`[direct-reminders-webhook] 🔍 Search result:`, directMaster ? {
          id: directMaster.id,
          name: directMaster.name,
          telegramUsername: directMaster.telegramUsername,
          telegramChatId: directMaster.telegramChatId,
        } : 'NOT FOUND');
        
        if (directMaster) {
          // Оновлюємо chatId в DirectMaster
          const updated = {
            ...directMaster,
            telegramChatId: chatId,
            updatedAt: new Date().toISOString(),
          };
          await saveDirectMaster(updated);
          console.log(`[direct-reminders-webhook] ✅ Updated DirectMaster ${directMaster.name} (@${fromUser.username}) with chatId: ${chatId}`);
          
          const botToken = getDirectRemindersBotToken();
          await sendMessage(
            chatId,
            `Привіт, ${directMaster.name}!\n\n` +
            `Ваш Telegram Chat ID (${chatId}) було автоматично збережено в системі.\n\n` +
            `Тепер ви будете отримувати повідомлення про відсутній Instagram username для клієнтів.`,
            {},
            botToken
          );
        } else {
          // Якщо не знайдено в DirectMaster, перевіряємо всіх майстрів
          const allMasters = await getAllDirectMasters();
          const masterByUsername = allMasters.find(m => 
            m.telegramUsername?.toLowerCase().replace(/^@/, '') === fromUser.username.toLowerCase()
          );
          
          if (masterByUsername) {
            // Оновлюємо chatId
            const updated = {
              ...masterByUsername,
              telegramChatId: chatId,
              updatedAt: new Date().toISOString(),
            };
            await saveDirectMaster(updated);
            console.log(`[direct-reminders-webhook] ✅ Updated DirectMaster ${masterByUsername.name} (@${fromUser.username}) with chatId: ${chatId}`);
            
            const botToken = getDirectRemindersBotToken();
            await sendMessage(
              chatId,
              `Привіт, ${masterByUsername.name}!\n\n` +
              `Ваш Telegram Chat ID (${chatId}) було автоматично збережено в системі.\n\n` +
              `Тепер ви будете отримувати повідомлення про відсутній Instagram username для клієнтів.`,
              {},
              botToken
            );
          } else {
            console.log(`[direct-reminders-webhook] ⚠️ No DirectMaster found for username @${fromUser.username}`);
            const botToken = getDirectRemindersBotToken();
            await sendMessage(
              chatId,
              `Привіт! Я не знайшов ваш профіль у системі Direct Manager.\n\n` +
              `Якщо ви адміністратор або майстер, будь ласка, повідомте адміністратору для додавання вашого профілю.`,
              {},
              botToken
            );
          }
        }
      } else {
        console.log(`[direct-reminders-webhook] ⚠️ /start command received but username is missing`);
        const botToken = getDirectRemindersBotToken();
        await sendMessage(
          chatId,
          `Привіт! Для реєстрації потрібен ваш Telegram username. Будь ласка, встановіть username в налаштуваннях Telegram.`,
          {},
          botToken
        );
      }
    } catch (err) {
      console.error(`[direct-reminders-webhook] Error processing /start command:`, err);
      const botToken = getDirectRemindersBotToken();
      await sendMessage(
        chatId,
        `Помилка при реєстрації. Будь ласка, спробуйте пізніше або зверніться до адміністратора.`,
        {},
        botToken
      );
      }
      return;
    }

    if (messageText) {
      // Обробка відповіді на повідомлення про відсутній Instagram
      if (message.reply_to_message?.text) {
        const repliedText = message.reply_to_message.text;
        console.log(`[direct-reminders-webhook] Processing reply message. Full replied text:`, repliedText);
        console.log(`[direct-reminders-webhook] Reply text length: ${repliedText.length}`);
        
        // Перевіряємо, чи це відповідь на повідомлення про відсутній Instagram
        if (repliedText.includes('Відсутній Instagram username') && repliedText.includes('Altegio ID:')) {
          console.log(`[direct-reminders-webhook] Detected reply to missing Instagram notification`);
          
          // Витягуємо Altegio ID з повідомлення (пробуємо різні формати)
          // Telegram може надсилати HTML, тому перевіряємо різні варіанти
          const altegioIdMatch = repliedText.match(/Altegio ID:\s*<code>(\d+)<\/code>|Altegio ID:\s*<code>(\d+)|Altegio ID:\s*(\d+)/);
          console.log(`[direct-reminders-webhook] Altegio ID match:`, altegioIdMatch);
          console.log(`[direct-reminders-webhook] Searching for Altegio ID in text...`);
          
          // Також пробуємо знайти без HTML тегів (на випадок, якщо Telegram надсилає plain text)
          if (!altegioIdMatch) {
            const plainMatch = repliedText.match(/Altegio ID[:\s]+(\d+)/i);
            console.log(`[direct-reminders-webhook] Plain text Altegio ID match:`, plainMatch);
            if (plainMatch) {
              const altegioClientId = parseInt(plainMatch[1], 10);
              if (!isNaN(altegioClientId)) {
                console.log(`[direct-reminders-webhook] Found Altegio ID via plain text: ${altegioClientId}`);
                // Продовжуємо обробку з цим ID
                await processInstagramUpdate(chatId, altegioClientId, messageText.trim());
                return;
              }
            }
          }
          
          if (altegioIdMatch) {
            const altegioClientId = parseInt(altegioIdMatch[1] || altegioIdMatch[2] || altegioIdMatch[3], 10);
            console.log(`[direct-reminders-webhook] Parsed Altegio ID: ${altegioClientId}`);
            
            if (!isNaN(altegioClientId)) {
              // Витягуємо Instagram username з відповіді (може бути з @ або без)
              const instagramText = messageText.trim().replace(/^@/, '').split(/\s+/)[0];
              console.log(`[direct-reminders-webhook] Extracted Instagram text: "${instagramText}"`);
              
              if (instagramText && instagramText.length > 0) {
                await processInstagramUpdate(chatId, altegioClientId, instagramText);
                return;
              } else {
                const botToken = getDirectRemindersBotToken();
                await sendMessage(
                  chatId,
                  `❌ Будь ласка, введіть Instagram username у відповідь (наприклад: username або @username).`,
                  {},
                  botToken
                );
                return;
              }
            } else {
              console.error(`[direct-reminders-webhook] Invalid Altegio ID: ${altegioIdMatch[1] || altegioIdMatch[2] || altegioIdMatch[3]}`);
            }
          } else {
            console.error(`[direct-reminders-webhook] ❌ Could not extract Altegio ID from message`);
            console.error(`[direct-reminders-webhook] Replied text was:`, repliedText);
          }
        } else {
          console.log(`[direct-reminders-webhook] ⚠️ Message is a reply, but replied text does not contain 'Відсутній Instagram username' or 'Altegio ID:'`);
          console.log(`[direct-reminders-webhook] Replied text preview:`, message.reply_to_message?.text?.substring(0, 200));
        }
      } else if (message.reply_to_message) {
        console.log(`[direct-reminders-webhook] ⚠️ Message is a reply, but reply_to_message.text is missing`);
        console.log(`[direct-reminders-webhook] Reply structure:`, {
          message_id: message.reply_to_message.message_id,
          hasText: !!message.reply_to_message.text,
          hasPhoto: !!message.reply_to_message.photo,
          hasCaption: !!message.reply_to_message.caption,
        });
      } else {
        console.log(`[direct-reminders-webhook] ℹ️ Message is not a reply (reply_to_message is null/undefined)`);
        console.log(`[direct-reminders-webhook] ⚠️ To update Instagram, you need to REPLY to the message about missing Instagram username`);
        console.log(`[direct-reminders-webhook] Full message structure:`, JSON.stringify(message, null, 2).substring(0, 2000));
      }
    }
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Error in handleMessage:`, err);
    const botToken = getDirectRemindersBotToken();
    try {
      await sendMessage(
        message?.chat.id || 0,
        `❌ Виникла помилка при обробці повідомлення. Будь ласка, спробуйте пізніше.`,
        {},
        botToken
      );
    } catch (sendErr) {
      console.error(`[direct-reminders-webhook] Failed to send error message:`, sendErr);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    assertDirectRemindersBotToken();

    const update = (await req.json()) as TelegramUpdate;
    console.log(`[direct-reminders-webhook] ✅ Received update:`, {
      updateId: update.update_id,
      hasMessage: !!update.message,
      hasCallbackQuery: !!update.callback_query,
      messageText: update.message?.text,
      messageChatId: update.message?.chat?.id,
      messageFromUsername: update.message?.from?.username,
      messageFromId: update.message?.from?.id,
      replyToMessage: !!update.message?.reply_to_message,
      replyToMessageId: update.message?.reply_to_message?.message_id,
      replyToMessageText: update.message?.reply_to_message?.text?.substring(0, 100),
      isStartCommand: update.message?.text?.startsWith('/start'),
      fullUpdate: JSON.stringify(update, null, 2).substring(0, 2000), // Перші 2000 символів для діагностики
    });

    // Обробляємо текстові повідомлення (відповіді на повідомлення про відсутній Instagram)
    if (update.message) {
      console.log(`[direct-reminders-webhook] Processing message from chat ${update.message.chat.id}`);
      await handleMessage(update.message);
    }
    
    // Обробляємо callback для Direct нагадувань
    if (update.callback_query) {
      console.log(`[direct-reminders-webhook] Processing callback query`);
      await handleCallback(update.callback_query);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[direct-reminders-webhook] Error processing update:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
