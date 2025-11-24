import { sendMessage } from "../telegram/api";
import { TELEGRAM_ENV } from "../telegram/env";
import {
  addReportToIndex,
  clearPendingPhotoRequest,
  getPendingPhotoRequest,
  savePendingPhotoRequest,
  savePhotoReport,
} from "./store";
import { AppointmentReminder, PhotoReport } from "./types";

export async function sendReminderMessage(
  chatId: number,
  appointment: AppointmentReminder
) {
  const text = [
    `📸 <b>Фото-звіт для ${appointment.masterName}</b>`,
    ``,
    `<b>Клієнт:</b> ${appointment.clientName}`,
    `<b>Процедура:</b> ${appointment.serviceName}`,
    `<b>Закінчується о:</b> ${new Date(appointment.endAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`,
    ``,
    `Будь ласка, надішліть фото прямо в цей чат до завершення візиту.`,
  ].join("\n");

  return sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📸 Надіслати фото",
            callback_data: `photo:${appointment.id}`,
          },
        ],
        [
          {
            text: "⏰ Нагадати через 5 хв",
            callback_data: `remind:${appointment.id}`,
          },
          {
            text: "❌ Клієнт пішов",
            callback_data: `missed:${appointment.id}`,
          },
        ],
      ],
    },
  });
}

export async function rememberPendingPhotoRequest(
  chatId: number,
  appointment: AppointmentReminder
) {
  await savePendingPhotoRequest({
    chatId,
    masterId: appointment.masterId,
    appointment,
    createdAt: new Date().toISOString(),
  });
}

export async function resolvePhotoReport(
  chatId: number,
  report: PhotoReport
) {
  await savePhotoReport(report);
  await addReportToIndex(report.appointmentId);
  await clearPendingPhotoRequest(chatId);
}

export async function getPendingRequestForChat(chatId: number) {
  return getPendingPhotoRequest(chatId);
}

export function notifyAdminsPlaceholder(message: string) {
  if (!TELEGRAM_ENV.ADMIN_CHAT_IDS.length) {
    console.warn("[telegram] No admin chat ids configured:", message);
    return Promise.resolve();
  }

  return Promise.all(
    TELEGRAM_ENV.ADMIN_CHAT_IDS.map((adminId) => sendMessage(adminId, message))
  );
}

