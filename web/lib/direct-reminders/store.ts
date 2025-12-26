// web/lib/direct-reminders/store.ts
// Зберігання нагадувань для Direct клієнтів

import { kv } from '@vercel/kv';
import type { DirectReminder } from './types';

const REMINDERS_INDEX_KEY = 'direct:reminders:index';
const REMINDER_KEY_PREFIX = 'direct:reminder:';

/**
 * Зберігає нагадування
 */
export async function saveDirectReminder(reminder: DirectReminder): Promise<void> {
  const key = `${REMINDER_KEY_PREFIX}${reminder.id}`;
  await kv.set(key, JSON.stringify(reminder));
  
  // Додаємо в індекс
  const index = await getRemindersIndex();
  if (!index.includes(reminder.id)) {
    index.push(reminder.id);
    await kv.set(REMINDERS_INDEX_KEY, JSON.stringify(index));
  }
  
  console.log(`[direct-reminders] ✅ Saved reminder ${reminder.id} for client ${reminder.directClientId}`);
}

/**
 * Отримує нагадування по ID
 */
export async function getDirectReminder(id: string): Promise<DirectReminder | null> {
  const key = `${REMINDER_KEY_PREFIX}${id}`;
  const raw = await kv.get<string>(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DirectReminder;
  } catch {
    return null;
  }
}

/**
 * Отримує всі нагадування
 */
export async function getAllDirectReminders(): Promise<DirectReminder[]> {
  const index = await getRemindersIndex();
  const reminders: DirectReminder[] = [];
  
  for (const id of index) {
    const reminder = await getDirectReminder(id);
    if (reminder) {
      reminders.push(reminder);
    }
  }
  
  return reminders;
}

/**
 * Отримує нагадування для конкретного клієнта
 */
export async function getDirectRemindersForClient(directClientId: string): Promise<DirectReminder[]> {
  const all = await getAllDirectReminders();
  return all.filter(r => r.directClientId === directClientId);
}

/**
 * Отримує нагадування, які потрібно надіслати
 */
export async function getPendingDirectReminders(now: Date = new Date()): Promise<DirectReminder[]> {
  const all = await getAllDirectReminders();
  const nowISO = now.toISOString();
  
  return all.filter(r => {
    if (r.status === 'completed' || r.status === 'all-good' || r.status === 'too-expensive') {
      return false;
    }
    
    // Перевіряємо, чи настав час надсилання
    return r.scheduledFor <= nowISO;
  });
}

/**
 * Отримує нагадування для повторного надсилання (no-call статус)
 */
export async function getRepeatReminders(now: Date = new Date()): Promise<DirectReminder[]> {
  const all = await getAllDirectReminders();
  const nowISO = now.toISOString();
  
  return all.filter(r => {
    if (r.status !== 'no-call') {
      return false;
    }
    
    // Перевіряємо, чи настав час для повторного нагадування
    // Повторні нагадування кожні 2 години після 12:00 (14:00, 16:00, 18:00, ...)
    if (!r.lastReminderAt) {
      return false;
    }
    
    const lastReminderTime = new Date(r.lastReminderAt).getTime();
    const twoHours = 2 * 60 * 60 * 1000; // 2 години в мілісекундах
    const nextReminderTime = lastReminderTime + twoHours;
    
    return now.getTime() >= nextReminderTime;
  });
}

/**
 * Отримує індекс нагадувань
 */
async function getRemindersIndex(): Promise<string[]> {
  const raw = await kv.get<string>(REMINDERS_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Видаляє нагадування
 */
export async function deleteDirectReminder(id: string): Promise<void> {
  const key = `${REMINDER_KEY_PREFIX}${id}`;
  await kv.del(key);
  
  // Видаляємо з індексу
  const index = await getRemindersIndex();
  const filtered = index.filter(i => i !== id);
  await kv.set(REMINDERS_INDEX_KEY, JSON.stringify(filtered));
  
  console.log(`[direct-reminders] ✅ Deleted reminder ${id}`);
}

