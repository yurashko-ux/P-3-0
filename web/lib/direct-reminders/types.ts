// web/lib/direct-reminders/types.ts
// Типи для нагадувань Direct клієнтів

export type DirectReminderStatus = 
  | 'pending'      // Очікує надсилання
  | 'sent'         // Надіслано
  | 'no-call'      // Недодзвон (потрібно повторне нагадування)
  | 'all-good'     // Все чудово
  | 'too-expensive' // Все добре, але занадто дорого
  | 'completed';   // Завершено (отримано відповідь)

export type DirectReminder = {
  id: string; // Унікальний ID нагадування
  directClientId: string; // ID клієнта в Direct Manager
  altegioClientId: number; // ID клієнта в Altegio
  visitId: number; // ID візиту в Altegio
  recordId: number; // ID запису в Altegio
  instagramUsername: string; // Instagram username клієнта
  phone?: string; // Номер телефону клієнта
  clientName: string; // Повне ім'я клієнта
  visitDate: string; // ISO date - дата візиту
  serviceName: string; // Назва послуги
  status: DirectReminderStatus;
  scheduledFor: string; // ISO date - коли планується надіслати
  sentAt?: string; // ISO date - коли було надіслано
  lastReminderAt?: string; // ISO date - коли було останнє нагадування
  reminderCount: number; // Кількість надісланих нагадувань (для повторних)
  createdAt: string; // ISO date - коли створено
  updatedAt: string; // ISO date - останнє оновлення
};

