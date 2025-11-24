import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { TelegramUpdate } from "@/lib/telegram/types";
import {
  answerCallbackQuery,
  forwardPhotoToReportGroup,
  sendMessage,
} from "@/lib/telegram/api";
import {
  rememberPendingPhotoRequest,
  getPendingRequestForChat,
  resolvePhotoReport,
  notifyAdminsPlaceholder,
} from "@/lib/photo-reports/reminders";
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

async function handleCallback(callback: NonNullable<TelegramUpdate["callback_query"]>) {
  const data = callback.data || "";
  const [action, appointmentId] = data.split(":");
  const chatId = callback.message?.chat.id;

  if (!chatId || !appointmentId) {
    await answerCallbackQuery(callback.id, {
      text: "Не вдалося обробити дію",
      show_alert: true,
    });
    return;
  }

  const appointment = findAppointmentById(appointmentId);

  if (!appointment) {
    await answerCallbackQuery(callback.id, {
      text: "Запис не знайдено",
      show_alert: true,
    });
    return;
  }

  switch (action) {
    case "send_photo": {
      const [, , fileId] = data.split(":");
      if (!fileId) {
        await answerCallbackQuery(callback.id, {
          text: "Помилка: не знайдено фото",
          show_alert: true,
        });
        return;
      }

      const pending = await getPendingRequestForChat(chatId);
      if (!pending) {
        await answerCallbackQuery(callback.id, {
          text: "Нагадування вже неактивне",
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
        telegramFileId: fileId,
        telegramMessageId: callback.message?.message_id || 0,
        caption: undefined,
      };

      await resolvePhotoReport(chatId, report);

      await answerCallbackQuery(callback.id, {
        text: "✅ Фото відправлено в групу!",
      });

      await sendMessage(
        chatId,
        `✅ Дякую! Фото по клієнту <b>${pending.appointment.clientName}</b> відправлено адміністраторам.`,
        {
          reply_markup: {
            remove_keyboard: true,
          },
        }
      );

      await forwardPhotoToReportGroup(
        fileId,
        [
          `📷 <b>${pending.appointment.masterName}</b>`,
          `<b>Клієнт:</b> ${pending.appointment.clientName}`,
          `<b>Процедура:</b> ${pending.appointment.serviceName}`,
          `<b>Час:</b> ${new Date().toLocaleString("uk-UA")}`,
        ].join("\n")
      );
      break;
    }

    case "cancel_photo":
      await answerCallbackQuery(callback.id, { text: "Скасовано" });
      await sendMessage(
        chatId,
        "Фото не відправлено. Можете надіслати його пізніше.",
        {
          reply_markup: {
            remove_keyboard: true,
          },
        }
      );
      break;

    case "remind":
      await answerCallbackQuery(callback.id, { text: "Нагадаю через кілька хвилин" });
      await sendMessage(
        chatId,
        `Нагадування для клієнта ${appointment.clientName} повторимо через кілька хвилин.`
      );
      break;

    case "missed":
      await answerCallbackQuery(callback.id, { text: "Адміністратор сповіщений" });
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

  // Показуємо кнопку "Відправити в групу" після отримання фото
  await sendMessage(
    chatId,
    `✅ Фото отримано!\n\nКлієнт: <b>${pending.appointment.clientName}</b>\nПроцедура: <b>${pending.appointment.serviceName}</b>\n\nНатисніть «✅ Відправити в групу», щоб надіслати фото адміністраторам.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Відправити в групу",
              callback_data: `send_photo:${pending.appointment.id}:${bestPhoto.file_id}`,
            },
          ],
          [
            {
              text: "❌ Скасувати",
              callback_data: `cancel_photo:${pending.appointment.id}`,
            },
          ],
        ],
      },
    }
  );
}

