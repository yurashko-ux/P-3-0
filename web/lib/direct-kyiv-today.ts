/**
 * Узгоджена перевірка «дата події = обраний календарний день у Europe/Kyiv».
 * Використовується в Direct: сортування блоку «сьогодні», товста лінія під блоком, GET /api/admin/direct/clients.
 * Fallback через kyivDayFromISO — для рядків, де лише format() давав би зсув або парсинг не спрацьовував.
 */
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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
      if (!isNaN(d.getTime()) && kyivDayFmt.format(d) === referenceKyivDay) return true;
    }
    for (const part of dateStr.split(/\s+/)) {
      const d = new Date(part);
      if (!isNaN(d.getTime()) && /^\d/.test(part)) {
        if (kyivDayFmt.format(d) === referenceKyivDay) return true;
      }
    }
  } catch {
    /* ignore */
  }
  const fallback = kyivDayFromISO(String(dateVal));
  return Boolean(fallback && fallback === referenceKyivDay);
}
