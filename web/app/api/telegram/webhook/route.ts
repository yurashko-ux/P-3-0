import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { TelegramUpdate } from "@/lib/telegram/types";
import {
  answerCallbackQuery,
  forwardPhotoToReportGroup,
  forwardMultiplePhotosToReportGroup,
  sendMessage,
  editMessageText,
} from "@/lib/telegram/api";
import { TELEGRAM_ENV } from "@/lib/telegram/env";
import {
  rememberPendingPhotoRequest,
  getPendingRequestForChat,
  resolvePhotoReport,
  notifyAdminsPlaceholder,
} from "@/lib/photo-reports/reminders";
import { addPhotoToPendingRequest, clearPendingPhotoRequest } from "@/lib/photo-reports/store";
import {
  findAppointmentById,
  findMasterByUsername,
} from "@/lib/photo-reports/service";
import {
  getRegisteredMasterByChatId,
  registerChatForMaster,
} from "@/lib/photo-reports/master-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertTelegramEnv();

    const update = (await req.json()) as TelegramUpdate;
    console.log(`[telegram/webhook] Received update:`, {
      hasMessage: !!update.message,
      hasCallbackQuery: !!update.callback_query,
      messageText: update.message?.text,
      messageChatId: update.message?.chat?.id,
      messageFromUsername: update.message?.from?.username,
      replyToMessage: !!update.message?.reply_to_message,
      replyToMessageText: update.message?.reply_to_message?.text?.substring(0, 100),
      updateId: update.update_id,
    });
    
    // Додаткова діагностика для відповідей
    if (update.message?.reply_to_message) {
      const replyMsg = update.message.reply_to_message as any; // Telegram API може містити додаткові поля
      console.log(`[telegram/webhook] 🔍 Reply detected! Full reply context:`, {
        replyText: replyMsg.text,
        replyTextLength: replyMsg.text?.length,
        replyHasEntities: !!replyMsg.entities,
        replyEntities: replyMsg.entities,
        messageText: update.message.text,
        messageFromId: update.message.from?.id,
        messageFromUsername: update.message.from?.username,
      });
    }
    
    if (update.message) {
      console.log(`[telegram/webhook] Processing message from chat ${update.message.chat.id}`);
      await handleMessage(update.message);
    } else if (update.callback_query) {
      console.log(`[telegram/webhook] Processing callback query`);
      await handleCallback(update.callback_query);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telegram/webhook] Error processing update:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

async function handleMessage(message: TelegramUpdate["message"]) {
  if (!message) {
    console.log(`[telegram/webhook] handleMessage: message is null/undefined`);
    return;
  }
  const chatId = message.chat.id;
  const fromUser = message.from;
  console.log(`[telegram/webhook] handleMessage: chatId=${chatId}, hasText=${!!message.text}, text="${message.text?.substring(0, 50)}", hasReply=${!!message.reply_to_message}, fromUsername=${fromUser?.username}`);

  if (message.text?.startsWith("/start")) {
    const registration = await registerChatForMaster(
      chatId,
      fromUser?.username,
      fromUser?.first_name,
      fromUser?.last_name
    );

    if (registration?.master) {
      await sendMessage(
        chatId,
        [
          `Привіт, ${registration.master.name}!`,
          "",
          "Я буду нагадувати про фото-звіти та автоматично надсилати їх адміністраторам.",
          "Коли отримаєш нагадування, натисни «📸 Надіслати фото» та прикріпи фото у відповідь.",
        ].join("\n")
      );
    } else {
      await sendMessage(
        chatId,
        "Привіт! Наразі я не знайшов твій профіль у списку майстрів. Будь ласка, повідом адміністратору."
      );
    }
    return;
  }

  if (message.photo?.length) {
    await processPhotoMessage(message);
    return;
  }

  if (message.text) {
    // Обробка відповіді на повідомлення про відсутній Instagram
    if (message.reply_to_message?.text) {
      const repliedText = message.reply_to_message.text;
      console.log(`[telegram/webhook] 🔍 Processing reply message. Full replied text length: ${repliedText.length}`);
      console.log(`[telegram/webhook] 🔍 Replied text (first 500 chars): ${repliedText.substring(0, 500)}`);
      console.log(`[telegram/webhook] 🔍 Checking for 'Відсутній Instagram username': ${repliedText.includes('Відсутній Instagram username')}`);
      console.log(`[telegram/webhook] 🔍 Checking for 'Altegio ID:': ${repliedText.includes('Altegio ID:')}`);
      
      // Перевіряємо, чи це відповідь на повідомлення про відсутній Instagram
      if (repliedText.includes('Відсутній Instagram username') && repliedText.includes('Altegio ID:')) {
        console.log(`[telegram/webhook] ✅ Detected reply to missing Instagram notification!`);
        console.log(`[telegram/webhook] Full replied text:`, repliedText);
        
        // Витягуємо Altegio ID з повідомлення (пробуємо різні формати)
        let altegioIdMatch = repliedText.match(/Altegio ID:\s*<code>(\d+)<\/code>|Altegio ID:\s*<code>(\d+)|Altegio ID:\s*(\d+)/);
        console.log(`[telegram/webhook] Altegio ID match (HTML):`, altegioIdMatch);
        
        // Також пробуємо знайти без HTML тегів (на випадок, якщо Telegram надсилає plain text)
        if (!altegioIdMatch) {
          altegioIdMatch = repliedText.match(/Altegio ID[:\s]+(\d+)/i);
          console.log(`[telegram/webhook] Altegio ID match (plain text):`, altegioIdMatch);
        }
        
        if (altegioIdMatch) {
          const altegioClientId = parseInt(altegioIdMatch[1] || altegioIdMatch[2] || altegioIdMatch[3], 10);
          console.log(`[telegram/webhook] Parsed Altegio ID: ${altegioClientId}`);
          
          if (!isNaN(altegioClientId) && altegioClientId > 0) {
            // Витягуємо Instagram username з відповіді (може бути з @ або без)
            const instagramText = message.text.trim().replace(/^@/, '').split(/\s+/)[0];
            console.log(`[telegram/webhook] Extracted Instagram text: "${instagramText}"`);
            
            if (instagramText && instagramText.length > 0) {
              try {
                const { updateInstagramForAltegioClient } = await import('@/lib/direct-store');
                const { normalizeInstagram } = await import('@/lib/normalize');
                const normalized = normalizeInstagram(instagramText);
                console.log(`[telegram/webhook] Normalized Instagram: "${normalized}"`);
                
                if (normalized) {
                  const updatedClient = await updateInstagramForAltegioClient(altegioClientId, normalized);
                  console.log(`[telegram/webhook] Update result:`, updatedClient ? {
                    success: true,
                    clientId: updatedClient.id,
                    instagramUsername: updatedClient.instagramUsername,
                    state: updatedClient.state,
                  } : { success: false });
                  
                  // Використовуємо правильний токен для відповіді (HOB_CLIENT_BOT_TOKEN, якщо є)
                  const { TELEGRAM_ENV } = await import('@/lib/telegram/env');
                  const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
                  
                  if (updatedClient) {
                    // Раніше тут пропускали відповідь, якщо є HOB_CLIENT_BOT_TOKEN — користувач не отримував підтвердження з основного бота
                    await sendMessage(
                      chatId,
                      `✅ Instagram username оновлено!\n\n` +
                      `Altegio ID: ${altegioClientId}\n` +
                      `Instagram: ${normalized}\n\n` +
                      `Тепер всі вебхуки для цього клієнта будуть оброблятися правильно.`,
                      {},
                      botToken
                    );
                    console.log(`[telegram/webhook] ✅ Updated Instagram for Altegio client ${altegioClientId} to ${normalized}`);
                    return;
                  } else {
                    await sendMessage(
                      chatId,
                      `❌ Не вдалося оновити Instagram username. Перевірте, чи існує клієнт з Altegio ID ${altegioClientId}.`,
                      {},
                      botToken
                    );
                    return;
                  }
                } else {
                  const { TELEGRAM_ENV } = await import('@/lib/telegram/env');
                  const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
                  await sendMessage(
                    chatId,
                    `❌ Невірний формат Instagram username. Будь ласка, введіть правильний username (наприклад: username або @username).`,
                    {},
                    botToken
                  );
                  return;
                }
              } catch (err) {
                console.error(`[telegram/webhook] Failed to update Instagram for Altegio client ${altegioClientId}:`, err);
                const { TELEGRAM_ENV } = await import('@/lib/telegram/env');
                const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
                await sendMessage(
                  chatId,
                  `❌ Помилка при оновленні Instagram username: ${err instanceof Error ? err.message : String(err)}`,
                  {},
                  botToken
                );
                return;
              }
            } else {
              const { TELEGRAM_ENV } = await import('@/lib/telegram/env');
              const botToken = TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
              await sendMessage(
                chatId,
                `❌ Будь ласка, введіть Instagram username у відповідь (наприклад: username або @username).`,
                {},
                botToken
              );
              return;
            }
          } else {
            console.error(`[telegram/webhook] Invalid Altegio ID: ${altegioIdMatch[1] || altegioIdMatch[2] || altegioIdMatch[3]}`);
          }
        } else {
          console.error(`[telegram/webhook] Could not extract Altegio ID from message. Full text:`, repliedText);
        }
      }
    }

    // Обробка кнопки "📸 Зробити фото"
    if (message.text === "📸 Зробити фото" || message.text.includes("📸 Зробити фото")) {
      const pending = await getPendingRequestForChat(chatId);
      if (pending) {
        await sendMessage(
          chatId,
          [
            `📸 <b>Надішліть фото для клієнта ${pending.appointment.clientName}</b>`,
            ``,
            `Використайте кнопку камери 📷 внизу екрану або вкладення (📎) → Фото або Відео.`,
            ``,
            `Після надсилання фото з'явиться кнопка для відправки в групу.`,
          ].join("\n")
        );
        return;
      } else {
        await sendMessage(
          chatId,
          "Немає активного запиту на фото. Дочекайтеся нагадування."
        );
        return;
      }
    }

    // Обробка кнопок з Reply Keyboard
    if (message.text.includes("⏰ Нагадати через 5 хв")) {
      const appointmentId = message.text.match(/\(([^)]+)\)$/)?.[1];
      if (appointmentId) {
        const appointment = findAppointmentById(appointmentId);
        if (appointment) {
          await sendMessage(
            chatId,
            `Нагадування для клієнта ${appointment.clientName} повторимо через кілька хвилин.`
          );
          return;
        }
      }
    }

    if (message.text.includes("❌ Клієнт пішов")) {
      const appointmentId = message.text.match(/\(([^)]+)\)$/)?.[1];
      if (appointmentId) {
        const appointment = findAppointmentById(appointmentId);
        if (appointment) {
          await notifyAdminsPlaceholder(
            `⚠️ ${appointment.masterName} зазначив, що клієнт ${appointment.clientName} пішов без фото.`
          );
          await sendMessage(
            chatId,
            "Адміністратор сповіщений. Дякую за інформацію!",
            {
              reply_markup: {
                remove_keyboard: true,
              },
            }
          );
          return;
        }
      }
    }

    await sendMessage(
      chatId,
      "Надішли фото через кнопку «📸 Зробити фото» або дочекайся нового нагадування."
    );
  }
}

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
    console.log(`[telegram/webhook] Handling change master callback for reminder ${reminderId}`);
    
    const { getDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getDirectMastersForSelection } = await import('@/lib/direct-masters/store');
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      console.warn(`[telegram/webhook] Reminder ${reminderId} not found`);
      const botToken = getDirectRemindersBotToken();
      await answerCallbackQuery(callback.id, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    // Отримуємо відповідальних з бази даних (вже відфільтровані)
    const masters = await getDirectMastersForSelection();
    console.log(`[telegram/webhook] Found ${masters.length} masters from database`);
    
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
      console.error(`[telegram/webhook] Missing chatId or messageId: chatId=${chatId}, messageId=${messageId}`);
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

    console.log(`[telegram/webhook] Updating message ${messageId} in chat ${chatId} with ${masters.length} masters`);

    // Оновлюємо повідомлення з кнопками майстрів
    await editMessageText(chatId, messageId, messageText, {
      reply_markup: keyboard,
    }, botToken);

    await answerCallbackQuery(callback.id, {
      text: `Оберіть відповідального (${masters.length} доступно)`,
    }, botToken);
    
    console.log(`[telegram/webhook] ✅ Successfully updated message with master selection`);
  } catch (err) {
    console.error(`[telegram/webhook] ❌ Failed to handle change master callback:`, err);
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
    
    // Перевіряємо, чи майстер має role='master' (не адміністратор або дірект-менеджер)
    if (master.role !== 'master') {
      await answerCallbackQuery(callback.id, {
        text: `Помилка: "${master.name}" не є майстром (роль: ${master.role}). В колонку "Майстер" можна вносити лише майстрів.`,
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
      console.log(`[telegram/webhook] ✅ Updated Direct client ${directClient.id} master to '${master.name}' (${master.id}) from reminder ${reminderId}`);
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
      text: `✅ Майстра змінено на: ${master.name}`,
    }, botToken);
  } catch (err) {
    console.error(`[telegram/webhook] ❌ Failed to handle select master callback:`, err);
    await answerCallbackQuery(callback.id, {
      text: 'Помилка обробки вибору майстра',
      show_alert: true,
    });
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
    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    const botToken = getDirectRemindersBotToken();
    
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
          { text: '👤 Заміна майстра', callback_data: `direct_reminder:${reminderId}:change-master` },
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
    console.error(`[telegram/webhook] ❌ Failed to handle back callback:`, err);
    await answerCallbackQuery(callback.id, {
      text: 'Помилка обробки',
      show_alert: true,
    });
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
        console.log(`[telegram/webhook] ✅ Updated Direct client ${directClient.id} state to '${clientState}' from reminder ${reminderId}`);
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
    console.log(`[telegram/webhook] ✅ Updated reminder ${reminderId} status to '${status}'`);
  } catch (err) {
    console.error(`[telegram/webhook] ❌ Failed to handle Direct reminder callback:`, err);
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
    await answerCallbackQuery(callback.id, {
      text: "Не вдалося обробити дію",
      show_alert: true,
    });
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

  // Обробка callback для фото-звітів
  const [action, appointmentId] = data.split(":");
  const pending = await getPendingRequestForChat(chatId);
  if (!pending) {
    await answerCallbackQuery(callback.id, {
      text: "Нагадування вже неактивне",
      show_alert: true,
    });
    return;
  }

  switch (action) {
    case "send_photos": {
      // Відправляємо всі фото з pending request
      if (!pending.photoFileIds || pending.photoFileIds.length === 0) {
        await answerCallbackQuery(callback.id, {
          text: "Помилка: не знайдено фото",
          show_alert: true,
        });
        return;
      }

      const reportId = randomUUID();
      const report = {
        id: reportId,
        appointmentId: pending.appointment.id,
        masterId: pending.masterId,
        masterName: pending.appointment.masterName,
        clientName: pending.appointment.clientName,
        serviceName: pending.appointment.serviceName,
        createdAt: new Date().toISOString(),
        telegramFileId: pending.photoFileIds[0], // Перше фото для сумісності
        telegramFileIds: pending.photoFileIds,
        telegramMessageId: callback.message?.message_id || 0,
        caption: undefined,
      };

      await resolvePhotoReport(chatId, report);

      await answerCallbackQuery(callback.id, {
        text: "✅ Фото відправлено в групу!",
      });

      await sendMessage(
        chatId,
        `✅ Дякую! ${pending.photoFileIds.length} фото по клієнту <b>${pending.appointment.clientName}</b> відправлено адміністраторам.`,
        {
          reply_markup: {
            remove_keyboard: true,
          },
        }
      );

      const caption = [
        `📷 <b>${pending.appointment.masterName}</b>`,
        `<b>Клієнт:</b> ${pending.appointment.clientName}`,
        `<b>Процедура:</b> ${pending.appointment.serviceName}`,
        `<b>Час:</b> ${new Date().toLocaleString("uk-UA")}`,
        pending.photoFileIds.length > 1 ? `<b>Кількість фото:</b> ${pending.photoFileIds.length}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await forwardMultiplePhotosToReportGroup(pending.photoFileIds, caption);
      break;
    }

    case "cancel_photo":
      await answerCallbackQuery(callback.id, { text: "Скасовано" });
      await sendMessage(
        chatId,
        "Фото не відправлено. Можете надіслати їх пізніше.",
        {
          reply_markup: {
            remove_keyboard: true,
          },
        }
      );
      // Очищаємо pending request
      await clearPendingPhotoRequest(chatId);
      break;

    case "add_more_photos":
      await answerCallbackQuery(callback.id, { text: "Надішліть ще фото" });
      await sendMessage(
        chatId,
        `📸 Надішліть ще фото для клієнта <b>${pending.appointment.clientName}</b>. Після надсилання з'явиться кнопка для відправки всіх фото.`
      );
      break;

    default:
      await answerCallbackQuery(callback.id, { text: "Невідома дія" });
  }
}

async function processPhotoMessage(message: NonNullable<TelegramUpdate["message"]>) {
  const chatId = message.chat.id;
  const pending = await getPendingRequestForChat(chatId);

  if (!pending) {
    await sendMessage(
      chatId,
      "Не знайдено активного нагадування. Дочекайтеся нового нагадування та натисніть «📸 Зробити фото».",
      {
        reply_markup: {
          remove_keyboard: true,
        },
      }
    );
    return;
  }

  const bestPhoto = message.photo?.[message.photo.length - 1];

  if (!bestPhoto) {
    await sendMessage(chatId, "Не вдалося прочитати фото. Спробуйте ще раз.");
    return;
  }

  // Додаємо фото до pending request
  const added = await addPhotoToPendingRequest(chatId, bestPhoto.file_id);
  if (!added) {
    await sendMessage(chatId, "Помилка при збереженні фото. Спробуйте ще раз.");
    return;
  }

  // Отримуємо оновлений pending request з усіма фото
  const updatedPending = await getPendingRequestForChat(chatId);
  if (!updatedPending) {
    await sendMessage(chatId, "Помилка: нагадування не знайдено.");
    return;
  }

  const photoCount = updatedPending.photoFileIds?.length || 0;

  // Показуємо кнопку "Відправити в групу" після отримання фото
  const text = [
    `✅ Фото отримано!`,
    ``,
    `<b>Клієнт:</b> ${pending.appointment.clientName}`,
    `<b>Процедура:</b> ${pending.appointment.serviceName}`,
    `<b>Фото:</b> ${photoCount} ${photoCount === 1 ? "фото" : photoCount < 5 ? "фото" : "фото"}`,
    ``,
    photoCount === 1
      ? `Натисніть «✅ Відправити в групу», щоб надіслати фото адміністраторам.`
      : `Натисніть «✅ Відправити в групу», щоб надіслати всі ${photoCount} фото адміністраторам.`,
  ].join("\n");

  await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `✅ Відправити в групу (${photoCount})`,
            callback_data: `send_photos:${pending.appointment.id}`,
          },
        ],
        [
          {
            text: "➕ Додати ще фото",
            callback_data: `add_more_photos:${pending.appointment.id}`,
          },
          {
            text: "❌ Скасувати",
            callback_data: `cancel_photo:${pending.appointment.id}`,
          },
        ],
      ],
    },
  });
}

