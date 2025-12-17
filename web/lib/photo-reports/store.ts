import { kv } from "@vercel/kv";
import { AppointmentReminder, PhotoReport } from "./types";

const REPORT_KEY_PREFIX = "photo-reports";
const PENDING_KEY_PREFIX = "photo-reports-pending";

const pendingKey = (chatId: number) => `${PENDING_KEY_PREFIX}:${chatId}`;
const reportKey = (appointmentId: string) =>
  `${REPORT_KEY_PREFIX}:${appointmentId}`;

export type PendingPhotoRequest = {
  chatId: number;
  masterId: string;
  appointment: AppointmentReminder;
  createdAt: string;
  photoFileIds: string[]; // Масив ID фото, які очікують відправки
};

export async function savePendingPhotoRequest(
  request: PendingPhotoRequest
): Promise<void> {
  await kv.set(pendingKey(request.chatId), request, {
    ex: 60 * 30, // expire in 30 minutes
  });
}

export async function getPendingPhotoRequest(chatId: number) {
  return kv.get<PendingPhotoRequest>(pendingKey(chatId));
}

export async function clearPendingPhotoRequest(chatId: number) {
  await kv.del(pendingKey(chatId));
}

export async function savePhotoReport(report: PhotoReport) {
  // Зберігаємо перше фото для сумісності
  if (!report.telegramFileId && report.telegramFileIds?.length > 0) {
    report.telegramFileId = report.telegramFileIds[0];
  }
  await kv.set(reportKey(report.appointmentId), report);
}

export async function addPhotoToPendingRequest(
  chatId: number,
  photoFileId: string
): Promise<boolean> {
  const pending = await getPendingPhotoRequest(chatId);
  if (!pending) {
    return false;
  }
  
  if (!pending.photoFileIds) {
    pending.photoFileIds = [];
  }
  
  if (!pending.photoFileIds.includes(photoFileId)) {
    pending.photoFileIds.push(photoFileId);
    await savePendingPhotoRequest(pending);
  }
  
  return true;
}

export async function getPhotoReportByAppointmentId(appointmentId: string) {
  return kv.get<PhotoReport>(reportKey(appointmentId));
}

export async function listRecentPhotoReports(limit = 20) {
  // KV не підтримує list, тому зберігаємо додатковий список ключів
  const indexKey = `${REPORT_KEY_PREFIX}:index`;
  const existing = (await kv.lrange<string>(indexKey, 0, -1)) || [];

  const reports: PhotoReport[] = [];

  for (const appointmentId of existing.slice(0, limit)) {
    const report = await getPhotoReportByAppointmentId(appointmentId);
    if (report) {
      reports.push(report);
    }
  }

  return reports;
}

export async function addReportToIndex(appointmentId: string) {
  const indexKey = `${REPORT_KEY_PREFIX}:index`;
  await kv.lpush(indexKey, appointmentId);
  await kv.ltrim(indexKey, 0, 99); // тримаємо останні 100
}

/**
 * Очищає всі фото-звіти (використовується для скидання статистики)
 */
export async function clearAllPhotoReports(): Promise<number> {
  const indexKey = `${REPORT_KEY_PREFIX}:index`;
  const appointmentIds = await kv.lrange<string>(indexKey, 0, -1);
  
  let deletedCount = 0;
  
  // Видаляємо всі фото-звіти
  for (const appointmentId of appointmentIds) {
    try {
      await kv.del(reportKey(appointmentId));
      deletedCount++;
    } catch (err) {
      console.warn(`[photo-reports/store] Failed to delete report ${appointmentId}:`, err);
    }
  }
  
  // Очищаємо індекс
  await kv.del(indexKey);
  
  return deletedCount;
}

