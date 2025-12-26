// web/lib/direct-reminders/telegram.ts
// Функції для надсилання нагадувань в Telegram

import { sendMessage } from '@/lib/telegram/api';
import { TELEGRAM_ENV } from '@/lib/telegram/env';

/**
 * Отримує токен бота для нагадувань Direct клієнтів
 * Використовує окремий токен, якщо встановлено, інакше - основний токен
 */
function getDirectRemindersBotToken(): string {
  return TELEGRAM_ENV.DIRECT_REMINDERS_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
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
  }
  
  // Додаємо chat_id адміністраторів з реєстру майстрів
  const masters = getMasters();
  const admins = masters.filter(m => m.role === 'admin');
  
  for (const admin of admins) {
    const chatId = await getChatIdForMaster(admin.id);
    if (chatId && !adminChatIds.includes(chatId)) {
      adminChatIds.push(chatId);
    }
  }
  
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
  const adminChatIds = await getAdminChatIds();
  const mykolayChatId = isTestMode ? await getMykolayChatId() : null;
  
  const message = formatReminderMessage(reminder);
  
  // Надсилаємо всім адміністраторам
  const allChatIds = [...adminChatIds];
  if (mykolayChatId && !allChatIds.includes(mykolayChatId)) {
    allChatIds.push(mykolayChatId);
  }
  
  if (allChatIds.length === 0) {
    console.warn('[direct-reminders] No admin chat IDs found, skipping reminder');
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
        { text: '👤 Заміна майстра', callback_data: `direct_reminder:${reminder.id}:change-master` },
      ],
    ],
  };
  
  const botToken = getDirectRemindersBotToken();
  
  for (const chatId of allChatIds) {
    try {
      await sendMessage(chatId, message, {
        reply_markup: keyboard,
      }, botToken);
      console.log(`[direct-reminders] ✅ Sent reminder ${reminder.id} to admin chat ${chatId}`);
    } catch (err) {
      console.error(`[direct-reminders] ❌ Failed to send reminder ${reminder.id} to chat ${chatId}:`, err);
    }
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
        { text: '👤 Заміна майстра', callback_data: `direct_reminder:${reminder.id}:change-master` },
      ],
    ],
  };
  
  const botToken = getDirectRemindersBotToken();
  
  for (const chatId of allChatIds) {
    try {
      await sendMessage(chatId, message, {
        reply_markup: keyboard,
      }, botToken);
      console.log(`[direct-reminders] ✅ Sent repeat reminder ${reminder.id} to admin chat ${chatId}`);
    } catch (err) {
      console.error(`[direct-reminders] ❌ Failed to send repeat reminder ${reminder.id} to chat ${chatId}:`, err);
    }
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

