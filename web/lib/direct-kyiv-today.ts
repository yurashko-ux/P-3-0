/**
 * Узгоджена перевірка «дата події = обраний календарний день у Europe/Kyiv».
 * Використовується в Direct: сортування блоку «сьогодні», товста лінія під блоком, GET /api/admin/direct/clients.
 * Fallback через kyivDayFromISO — для рядків, де лише format() давав би зсув або парсинг не спрацьовував.
 */
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

/** Денормалізація в БД: YYYY-MM-DD у Kyiv з ISO/Date (для consultationBookingKyivDay / paidServiceKyivDay). */
export function kyivYmdFromDateTimeInput(dt: Date | string | null | undefined): string | null {
  if (dt == null) return null;
  try {
    const iso = dt instanceof Date ? dt.toISOString() : String(dt);
    const y = kyivDayFromISO(iso);
    return y || null;
  } catch {
    return null;
  }
}

/** Один спосіб отримати YYYY-MM-DD у Kyiv — і для «сьогодні», і для порівняння (без розбіжностей format() vs formatToParts). */
function kyivYmdFromJsDate(d: Date): string {
  if (isNaN(d.getTime())) return '';
  return kyivDayFromISO(d.toISOString());
}

export function isKyivCalendarDayEqualToReference(
  dateVal: string | null | undefined,
  referenceKyivDay: string
): boolean {
  if (!dateVal) return false;
  try {
    const dateStr = typeof dateVal === 'string' ? dateVal.trim() : String(dateVal);
    const isoMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
    if (isoMatch) {
      const d = new Date(isoMatch[0]);
      const ymd = kyivYmdFromJsDate(d);
      if (ymd && ymd === referenceKyivDay) return true;
    }
    for (const part of dateStr.split(/\s+/)) {
      const d = new Date(part);
      if (!isNaN(d.getTime()) && /^\d/.test(part)) {
        const ymd = kyivYmdFromJsDate(d);
        if (ymd && ymd === referenceKyivDay) return true;
      }
    }
  } catch {
    /* ignore */
  }
  const fallback = kyivDayFromISO(String(dateVal));
  return Boolean(fallback && fallback === referenceKyivDay);
}
