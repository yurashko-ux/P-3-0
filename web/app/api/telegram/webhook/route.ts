import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { TelegramUpdate } from "@/lib/telegram/types";
import {
  answerCallbackQuery,
  forwardPhotoToReportGroup,
  forwardMultiplePhotosToReportGroup,
  sendMessage,
} from "@/lib/telegram/api";
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

    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telegram/webhook] Error processing update:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

async function handleMessage(message: TelegramUpdate["message"]) {
  if (!message) return;
  const chatId = message.chat.id;
  const fromUser = message.from;

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
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      await answerCallbackQuery(callbackId, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      });
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
        text: status === 'all-good' ? '✅ Статус оновлено: Все чудово' : '💰 Статус оновлено: Все добре, але занадто дорого',
      });
    } else if (status === 'no-call') {
      reminder.status = 'no-call';
      reminder.lastReminderAt = new Date().toISOString();
      // Наступне нагадування буде надіслано через 2 години (обробляється в cron)
      
      await answerCallbackQuery(callbackId, {
        text: '📞 Нагадування буде надіслано повторно через 2 години',
      });
    }
    
    await saveDirectReminder(reminder);
    console.log(`[telegram/webhook] ✅ Updated reminder ${reminderId} status to '${status}'`);
  } catch (err) {
    console.error(`[telegram/webhook] ❌ Failed to handle Direct reminder callback:`, err);
    await answerCallbackQuery(callbackId, {
      text: 'Помилка обробки нагадування',
      show_alert: true,
    });
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
      const [, reminderId, status] = parts;
      await handleDirectReminderCallback(callback.id, reminderId, status as 'all-good' | 'too-expensive' | 'no-call');
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

