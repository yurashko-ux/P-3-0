// web/lib/direct-reminders/telegram.ts
// Функції для надсилання нагадувань в Telegram

import { sendMessage } from '@/lib/telegram/api';
import { TELEGRAM_ENV } from '@/lib/telegram/env';

/**
 * Отримує токен бота для нагадувань Direct клієнтів (HOB_client_bot)
 * Використовує окремий токен, якщо встановлено, інакше - основний токен
 */
function getDirectRemindersBotToken(): string {
  const token = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
  console.log(`[direct-reminders] Using bot token: ${token ? `${token.substring(0, 10)}...` : 'NOT SET'}`);
  console.log(`[direct-reminders] HOB_CLIENT_BOT_TOKEN: ${TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN ? 'SET' : 'NOT SET'}`);
  console.log(`[direct-reminders] BOT_TOKEN (fallback): ${TELEGRAM_ENV.BOT_TOKEN ? 'SET' : 'NOT SET'}`);
  if (!token) {
    throw new Error('Missing Telegram bot token for Direct reminders. Set TELEGRAM_HOB_CLIENT_BOT_TOKEN or TELEGRAM_BOT_TOKEN');
  }
  return token;
}
import { getChatIdForMaster, listRegisteredChats } from '@/lib/photo-reports/master-registry';
import { findMasterById, getMasters } from '@/lib/photo-reports/service';
import type { DirectReminder } from './types';

/**
 * Отримує chat_id адміністраторів
 */
export async function getAdminChatIds(): Promise<number[]> {
  const adminChatIds: number[] = [];
  
  // Додаємо chat_id з env (TELEGRAM_ADMIN_CHAT_IDS)
  if (TELEGRAM_ENV.ADMIN_CHAT_IDS && TELEGRAM_ENV.ADMIN_CHAT_IDS.length > 0) {
    adminChatIds.push(...TELEGRAM_ENV.ADMIN_CHAT_IDS);
    console.log(`[direct-reminders] Added ${TELEGRAM_ENV.ADMIN_CHAT_IDS.length} admin chat IDs from env`);
  }
  
  // Додаємо chat_id адміністраторів та дірект-менеджерів з бази даних DirectMaster
  const { getAllDirectMasters } = await import('@/lib/direct-masters/store');
  try {
    const directMasters = await getAllDirectMasters();
    // Включаємо адміністраторів та дірект-менеджерів
    const directAdminsAndManagers = directMasters.filter(m => m.role === 'admin' || m.role === 'direct-manager');
    console.log(`[direct-reminders] Found ${directAdminsAndManagers.length} admins and direct-managers in DirectMaster database:`, directAdminsAndManagers.map(a => ({ id: a.id, name: a.name, role: a.role, username: a.telegramUsername, chatId: a.telegramChatId })));
    
    for (const adminOrManager of directAdminsAndManagers) {
      // Спочатку перевіряємо chatId з бази даних
      if (adminOrManager.telegramChatId) {
        // Конвертуємо bigint в number для сумісності з масивом number[]
        // Використовуємо Number() для конвертації, але перевіряємо, чи не втратили точність
        let chatId: number;
        if (typeof adminOrManager.telegramChatId === 'bigint') {
          // Для великих чисел перевіряємо, чи не втратили точність
          const bigIntValue = adminOrManager.telegramChatId;
          const numberValue = Number(bigIntValue);
          if (numberValue > Number.MAX_SAFE_INTEGER) {
            console.warn(`[direct-reminders] ⚠️ Chat ID ${bigIntValue} is too large for safe number conversion, using string representation`);
            // Telegram API приймає chat_id як string або number, тому можемо використати string
            // Але для сумісності з масивом number[] використовуємо number (може втратити точність)
            chatId = numberValue;
          } else {
            chatId = numberValue;
          }
        } else {
          chatId = Number(adminOrManager.telegramChatId);
        }
        
        if (!isNaN(chatId) && isFinite(chatId) && !adminChatIds.includes(chatId)) {
          adminChatIds.push(chatId);
          console.log(`[direct-reminders] ✅ Added ${adminOrManager.role} ${adminOrManager.name} (@${adminOrManager.telegramUsername}) with chatId from database: ${chatId}`);
        } else {
          console.warn(`[direct-reminders] ⚠️ Invalid chatId for ${adminOrManager.name}: ${adminOrManager.telegramChatId}`);
        }
      }
    }
  } catch (err) {
    console.error('[direct-reminders] Error getting admins and managers from DirectMaster database:', err);
  }
  
  // Також додаємо chat_id адміністраторів з реєстру майстрів (photo-reports)
  const masters = getMasters();
  const admins = masters.filter(m => m.role === 'admin');
  console.log(`[direct-reminders] Found ${admins.length} admins in photo-reports masters list:`, admins.map(a => ({ id: a.id, name: a.name, username: a.telegramUsername })));
  
  // Також шукаємо через зареєстровані чати по username
  const { listRegisteredChats } = await import('@/lib/photo-reports/master-registry');
  const registeredChats = await listRegisteredChats();
  console.log(`[direct-reminders] Found ${registeredChats.length} registered chats`);
  
  for (const admin of admins) {
    // Спочатку пробуємо знайти через masterId
    let chatId = await getChatIdForMaster(admin.id);
    
    // Якщо не знайдено через masterId, пробуємо знайти через username в зареєстрованих чатах
    if (!chatId && admin.telegramUsername) {
      const usernameLower = admin.telegramUsername.toLowerCase().replace('@', '');
      const chatEntry = registeredChats.find(chat => {
        const chatUsername = chat.username?.toLowerCase().replace('@', '');
        return chatUsername === usernameLower;
      });
      if (chatEntry) {
        chatId = chatEntry.chatId;
        console.log(`[direct-reminders] Found chatId for admin ${admin.name} (@${admin.telegramUsername}) via username: ${chatId}`);
      }
    }
    
    if (chatId && !adminChatIds.includes(chatId)) {
      adminChatIds.push(chatId);
      console.log(`[direct-reminders] ✅ Added admin ${admin.name} (@${admin.telegramUsername}) with chatId: ${chatId}`);
    } else if (!chatId) {
      console.warn(`[direct-reminders] ⚠️ Could not find chatId for admin ${admin.name} (@${admin.telegramUsername}) - add chatId in DirectMaster form or register via /start`);
    }
  }
  
  console.log(`[direct-reminders] Total admin chat IDs: ${adminChatIds.length}`, adminChatIds);
  return adminChatIds;
}

/**
 * Отримує chat_id Миколая Юрашко для тестування
 */
export async function getMykolayChatId(): Promise<number | null> {
  const masters = getMasters();
  const mykolay = masters.find(m => 
    m.name.toLowerCase().includes('миколай') || 
    m.name.toLowerCase().includes('mykolay') ||
    m.name.toLowerCase().includes('юрашко')
  );
  
  if (!mykolay) {
    return null;
  }
  
  return await getChatIdForMaster(mykolay.id);
}

/**
 * Надсилає нагадування адміністраторам
 */
export async function sendDirectReminderToAdmins(
  reminder: DirectReminder,
  isTestMode: boolean = true
): Promise<void> {
  console.log(`[direct-reminders] sendDirectReminderToAdmins called for reminder ${reminder.id}, isTestMode: ${isTestMode}`);
  
  const adminChatIds = await getAdminChatIds();
  console.log(`[direct-reminders] Found ${adminChatIds.length} admin chat IDs from env`);
  
  const mykolayChatId = isTestMode ? await getMykolayChatId() : null;
  console.log(`[direct-reminders] Mykolay chat ID: ${mykolayChatId || 'not found'}`);
  
  const message = formatReminderMessage(reminder);
  
  // Надсилаємо всім адміністраторам
  const allChatIds = [...adminChatIds];
  if (mykolayChatId && !allChatIds.includes(mykolayChatId)) {
    allChatIds.push(mykolayChatId);
  }
  
  console.log(`[direct-reminders] Total chat IDs to send to: ${allChatIds.length}`);
  
  if (allChatIds.length === 0) {
    console.warn('[direct-reminders] No admin chat IDs found, skipping reminder');
    console.warn('[direct-reminders] Check TELEGRAM_ADMIN_CHAT_IDS env variable or master registry');
    return;
  }
  
  // Надсилаємо з кнопками для відповіді
  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Все чудово', callback_data: `direct_reminder:${reminder.id}:all-good` },
        { text: '💰 За дорого', callback_data: `direct_reminder:${reminder.id}:too-expensive` },
      ],
      [
        { text: '📞 Недодзвон', callback_data: `direct_reminder:${reminder.id}:no-call` },
        { text: '👤 Заміна відповідального', callback_data: `direct_reminder:${reminder.id}:change-master` },
      ],
    ],
  };
  
  const botToken = getDirectRemindersBotToken();
  
  console.log(`[direct-reminders] Sending reminder ${reminder.id} to ${allChatIds.length} admin chats`);
  
  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const chatId of allChatIds) {
    try {
      console.log(`[direct-reminders] Attempting to send reminder ${reminder.id} to chat ${chatId} using token ${botToken.substring(0, 10)}...`);
      const result = await sendMessage(chatId, message, {
        reply_markup: keyboard,
      }, botToken);
      console.log(`[direct-reminders] ✅ Sent reminder ${reminder.id} to admin chat ${chatId}`, result);
      successCount++;
    } catch (err) {
      errorCount++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Chat ${chatId}: ${errorMsg}`);
      console.error(`[direct-reminders] ❌ Failed to send reminder ${reminder.id} to chat ${chatId}:`, err);
      if (err instanceof Error) {
        console.error(`[direct-reminders] Error details: ${err.message}`);
        console.error(`[direct-reminders] Stack: ${err.stack}`);
      }
    }
  }

  console.log(`[direct-reminders] Summary: sent to ${successCount}/${allChatIds.length} chats, errors: ${errorCount}`);
  if (errors.length > 0) {
    console.error(`[direct-reminders] Errors:`, errors);
  }

  if (successCount === 0 && allChatIds.length > 0) {
    throw new Error(`Failed to send reminder to any chat. Errors: ${errors.join('; ')}`);
  }
}

/**
 * Форматує повідомлення нагадування
 */
function formatReminderMessage(reminder: DirectReminder): string {
  const visitDate = new Date(reminder.visitDate).toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  
  const lines = [
    '📞 <b>Нагадування про клієнта</b>',
    '',
    `<b>Клієнт:</b> ${reminder.clientName}`,
    reminder.phone ? `<b>Телефон:</b> ${reminder.phone}` : null,
    `<b>Instagram:</b> @${reminder.instagramUsername}`,
    `<b>Послуга:</b> ${reminder.serviceName}`,
    `<b>Дата візиту:</b> ${visitDate}`,
    '',
    'Будь ласка, зателефонуйте клієнту та оновіть статус.',
  ].filter(Boolean);
  
  return lines.join('\n');
}

/**
 * Надсилає повторне нагадування (для "Недодзвон")
 */
export async function sendRepeatReminderToAdmins(
  reminder: DirectReminder,
  isTestMode: boolean = true
): Promise<void> {
  const adminChatIds = await getAdminChatIds();
  const mykolayChatId = isTestMode ? await getMykolayChatId() : null;
  
  const message = formatRepeatReminderMessage(reminder);
  
  const allChatIds = [...adminChatIds];
  if (mykolayChatId && !allChatIds.includes(mykolayChatId)) {
    allChatIds.push(mykolayChatId);
  }
  
  if (allChatIds.length === 0) {
    console.warn('[direct-reminders] No admin chat IDs found, skipping repeat reminder');
    return;
  }
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Все чудово', callback_data: `direct_reminder:${reminder.id}:all-good` },
        { text: '💰 За дорого', callback_data: `direct_reminder:${reminder.id}:too-expensive` },
      ],
      [
        { text: '📞 Недодзвон', callback_data: `direct_reminder:${reminder.id}:no-call` },
        { text: '👤 Заміна відповідального', callback_data: `direct_reminder:${reminder.id}:change-master` },
      ],
    ],
  };
  
  const botToken = getDirectRemindersBotToken();
  
  console.log(`[direct-reminders] Sending repeat reminder ${reminder.id} to ${allChatIds.length} admin chats`);
  
  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const chatId of allChatIds) {
    try {
      console.log(`[direct-reminders] Attempting to send repeat reminder ${reminder.id} to chat ${chatId} using token ${botToken.substring(0, 10)}...`);
      const result = await sendMessage(chatId, message, {
        reply_markup: keyboard,
      }, botToken);
      console.log(`[direct-reminders] ✅ Sent repeat reminder ${reminder.id} to admin chat ${chatId}`, result);
      successCount++;
    } catch (err) {
      errorCount++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Chat ${chatId}: ${errorMsg}`);
      console.error(`[direct-reminders] ❌ Failed to send repeat reminder ${reminder.id} to chat ${chatId}:`, err);
      if (err instanceof Error) {
        console.error(`[direct-reminders] Error details: ${err.message}`);
        console.error(`[direct-reminders] Stack: ${err.stack}`);
      }
    }
  }

  console.log(`[direct-reminders] Summary: sent to ${successCount}/${allChatIds.length} chats, errors: ${errorCount}`);
  if (errors.length > 0) {
    console.error(`[direct-reminders] Errors:`, errors);
  }

  if (successCount === 0 && allChatIds.length > 0) {
    throw new Error(`Failed to send repeat reminder to any chat. Errors: ${errors.join('; ')}`);
  }
}

/**
 * Форматує повідомлення повторного нагадування
 */
function formatRepeatReminderMessage(reminder: DirectReminder): string {
  const visitDate = new Date(reminder.visitDate).toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  
  const lines = [
    '🔄 <b>Повторне нагадування про клієнта</b>',
    '',
    `<b>Клієнт:</b> ${reminder.clientName}`,
    reminder.phone ? `<b>Телефон:</b> ${reminder.phone}` : null,
    `<b>Instagram:</b> @${reminder.instagramUsername}`,
    `<b>Послуга:</b> ${reminder.serviceName}`,
    `<b>Дата візиту:</b> ${visitDate}`,
    `<b>Кількість нагадувань:</b> ${reminder.reminderCount + 1}`,
    '',
    'Будь ласка, зателефонуйте клієнту та оновіть статус.',
  ].filter(Boolean);
  
  return lines.join('\n');
}

