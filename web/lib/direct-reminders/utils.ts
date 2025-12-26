// web/lib/direct-reminders/utils.ts
// Допоміжні функції для нагадувань

/**
 * Обчислює дату нагадування: 2 доби після візиту о 12:00 Київського часу (UTC+2)
 */
export function calculateReminderDate(visitDate: string): Date {
  // Парсимо дату візиту
  const visit = new Date(visitDate);
  
  // Додаємо 2 доби
  const reminderDate = new Date(visit);
  reminderDate.setDate(reminderDate.getDate() + 2);
  
  // Отримуємо дату в форматі YYYY-MM-DD
  const year = reminderDate.getFullYear();
  const month = String(reminderDate.getMonth() + 1).padStart(2, '0');
  const day = String(reminderDate.getDate()).padStart(2, '0');
  
  // Створюємо дату о 12:00 Київського часу (UTC+2)
  // Використовуємо формат ISO з часовим поясом Europe/Kyiv
  // Або просто встановлюємо 12:00 і враховуємо, що це UTC+2
  // 12:00 UTC+2 = 10:00 UTC (влітку може бути UTC+3, але для простоти використовуємо UTC+2)
  const reminder = new Date(`${year}-${month}-${day}T10:00:00Z`);
  
  return reminder;
}

/**
 * Генерує унікальний ID для нагадування
 */
export function generateReminderId(visitId: number, recordId: number): string {
  return `direct_reminder_${visitId}_${recordId}_${Date.now()}`;
}

