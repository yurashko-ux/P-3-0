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

  // Зберігаємо pending request, щоб знати, що чекаємо фото
  await rememberPendingPhotoRequest(chatId, appointment);

  return sendMessage(chatId, text, {
    reply_markup: {
      keyboard: [
        [
          {
            text: "📸 Зробити фото",
            request_photo: true,
          },
        ],
        [
          {
            text: `⏰ Нагадати через 5 хв (${appointment.id})`,
          },
          {
            text: `❌ Клієнт пішов (${appointment.id})`,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
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

