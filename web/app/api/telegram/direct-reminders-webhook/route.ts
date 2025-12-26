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

export async function POST(req: NextRequest) {
  try {
    assertDirectRemindersBotToken();

    const update = (await req.json()) as TelegramUpdate;

    // Обробляємо тільки callback для Direct нагадувань
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[direct-reminders-webhook] Error processing update:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
