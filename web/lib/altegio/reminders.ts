// web/lib/altegio/reminders.ts
// Типи та утиліти для нагадувань про візити

export type ReminderRule = {
  id: string; // "before_7d", "before_3d", "before_1d"
  daysBefore: number; // 7, 3, 1
  active: boolean;
  channel: 'instagram_dm';
  template: string;
};

export type ReminderJobStatus = 'pending' | 'sent' | 'failed' | 'canceled';

export type ReminderJob = {
  id: string; // `${visitId}:${ruleId}`
  ruleId: string;
  visitId: number;
  companyId: number;
  clientId: number;
  instagram: string | null;
  datetime: string; // ISO string візиту
  dueAt: number; // timestamp, коли треба надіслати
  payload: {
    clientName: string;
    phone: string | null;
    email: string | null;
    serviceTitle: string | null;
    staffName: string | null;
  };
  status: ReminderJobStatus;
  attempts: number;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
  canceledAt?: number;
};

// Правила нагадувань (поки що захардкоджені, потім можна винести в конфіг/UI)
export const REMINDER_RULES: ReminderRule[] = [
  {
    id: 'before_7d',
    daysBefore: 7,
    active: true,
    channel: 'instagram_dm',
    template: 'Нагадуємо про ваш візит {date} о {time} у Home of Beauty. Чекаємо вас! ❤️',
  },
  {
    id: 'before_3d',
    daysBefore: 3,
    active: true,
    channel: 'instagram_dm',
    template: 'Через {daysLeft} дні(в) у вас запис {date} о {time}. Підготуйтеся до візиту!',
  },
  {
    id: 'before_1d',
    daysBefore: 1,
    active: true,
    channel: 'instagram_dm',
    template: 'Завтра у вас візит {date} о {time}. Чекаємо вас! ❤️',
  },
];

/**
 * Форматує текст нагадування з плейсхолдерами
 */
export function formatReminderMessage(job: ReminderJob, rule: ReminderRule): string {
  const visitDate = new Date(job.datetime);
  const dateStr = visitDate.toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeStr = visitDate.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const daysLeft = Math.round((visitDate.getTime() - Date.now()) / (24 * 3600_000));

  return rule.template
    .replace('{clientName}', job.payload.clientName || '')
    .replace('{instagram}', job.instagram ? '@' + job.instagram : '')
    .replace('{date}', dateStr)
    .replace('{time}', timeStr)
    .replace('{service}', job.payload.serviceTitle || '')
    .replace('{master}', job.payload.staffName || '')
    .replace('{daysLeft}', String(daysLeft));
}

/**
 * Отримує активні правила нагадувань
 */
export function getActiveReminderRules(): ReminderRule[] {
  return REMINDER_RULES.filter((rule) => rule.active);
}

/**
 * Генерує jobId для нагадування
 */
export function generateReminderJobId(visitId: number, ruleId: string): string {
  return `${visitId}:${ruleId}`;
}

/**
 * Обчислює dueAt (timestamp) для нагадування
 */
export function calculateDueAt(visitDateTime: string, daysBefore: number): number {
  const visitAt = new Date(visitDateTime).getTime();
  return visitAt - daysBefore * 24 * 3600_000;
}

