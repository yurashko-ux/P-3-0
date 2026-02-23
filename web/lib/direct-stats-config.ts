// web/lib/direct-stats-config.ts
// Єдині константи та утиліти для статистики Direct.
// Використовувати в усіх endpoints, що рахують статистику — без розбіжностей (999 vs 9999 тощо).

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

/** Кількість записів для altegio:records:log (KV). lrange(0, N-1) = N елементів. */
export const KV_LIMIT_RECORDS = 10000;

/** Кількість записів для altegio:webhook:log (KV). lrange(0, N-1) = N елементів. */
export const KV_LIMIT_WEBHOOK = 10000;

/**
 * Чи є username плейсхолдером (системний запис, не реальний клієнт).
 * Виключаємо з підрахунку "Нові ліди" та інших метрик.
 */
export function isPlaceholderUsername(u?: string | null): boolean {
  return !u || u.startsWith('missing_instagram_') || u.startsWith('no_instagram_');
}

/**
 * Конвертує ISO дату/час у день у Europe/Kyiv (YYYY-MM-DD).
 * @param iso — ISO рядок або null/undefined
 */
export function toKyivDay(iso?: string | null): string {
  if (!iso) return '';
  const s = String(iso).trim();
  if (!s) return '';
  // Нормалізуємо "YYYY-MM-DD HH:mm:ss" (Altegio) до ISO для коректного парсингу
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d/.test(s) ? s.replace(/(\d{4}-\d{2}-\d{2})\s+/, '$1T') : s;
  return kyivDayFromISO(normalized);
}

/**
 * Повертає сьогоднішній день у Europe/Kyiv (YYYY-MM-DD).
 * Якщо передано dayParam у форматі YYYY-MM-DD — повертає його.
 */
export function getTodayKyiv(dayParam?: string | null): string {
  const trimmed = (dayParam || '').trim().replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return kyivDayFromISO(new Date().toISOString());
}

/**
 * UTC-межі дня YYYY-MM-DD у Europe/Kyiv. Як Direct-фільтр (toKyivDay).
 * firstContactDate зберігається в UTC — повертає [start, end) для Prisma.
 */
export function getKyivDayUtcBounds(kyivDateStr: string): { startUtc: Date; endUtc: Date } {
  const [y, m, d] = kyivDateStr.split('-').map(Number);
  let lo = Date.UTC(y, m - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    const day = kyivDayFromISO(new Date(mid).toISOString());
    if (day >= kyivDateStr) hi = mid;
    else lo = mid;
  }
  const startUtc = new Date(hi);
  const nextDate = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  let lo2 = startUtc.getTime();
  let hi2 = Date.UTC(y, m - 1, d + 2, 0, 0, 0);
  while (lo2 < hi2 - 1) {
    const mid = Math.floor((lo2 + hi2) / 2);
    const day = kyivDayFromISO(new Date(mid).toISOString());
    if (day > kyivDateStr) hi2 = mid;
    else lo2 = mid;
  }
  const endUtc = new Date(hi2);
  return { startUtc, endUtc };
}
