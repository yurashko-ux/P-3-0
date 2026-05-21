import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { toKyivDay } from '@/lib/direct-stats-config';

/** Клієнт має майбутній платний запис (строго після сьогодні, Europe/Kyiv). Як фільтр «Запис → Майбутні». */
export function hasFuturePaidServiceRecord(
  c: { paidServiceKyivDay?: string | null; paidServiceDate?: string | Date | null },
  todayKyiv: string
): boolean {
  const day = (
    (c.paidServiceKyivDay ?? '').trim() ||
    toKyivDay(
      c.paidServiceDate != null
        ? typeof c.paidServiceDate === 'string'
          ? c.paidServiceDate
          : (c.paidServiceDate as Date)?.toISOString?.() ?? ''
        : null
    )
  ).trim();
  return day > todayKyiv;
}

export type GlobalDaysCounts = {
  activeBase: number;
  inactiveBase: number;
  consultation: number;
  none: number;
  growing: number;
  grown: number;
  overgrown: number;
};

/** Мінімальні поля для getLastAttendedVisitDate (дубль з route admin/direct/clients). */
function getLastAttendedVisitDate(c: {
  consultationAttended?: boolean | null;
  consultationAttendanceValue?: 1 | 2 | null;
  consultationDate?: Date | string | null;
  consultationBookingDate?: Date | string | null;
  paidServiceAttended?: boolean | null;
  paidServiceAttendanceValue?: 1 | 2 | null;
  paidServiceDate?: Date | string | null;
  lastVisitAt?: Date | string | null;
}): string {
  const dates: string[] = [];
  if (c.consultationAttended === true && c.consultationAttendanceValue === 1) {
    const d = c.consultationDate ?? c.consultationBookingDate;
    const iso = (typeof d === 'string' ? d : (d as Date)?.toISOString?.()) || '';
    if (iso) dates.push(iso);
  }
  if (c.paidServiceAttended === true && c.paidServiceAttendanceValue === 1 && c.paidServiceDate) {
    const iso =
      (typeof c.paidServiceDate === 'string' ? c.paidServiceDate : (c.paidServiceDate as Date)?.toISOString?.()) ||
      '';
    if (iso) dates.push(iso);
  }
  let iso = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '';
  if (!iso) iso = ((c as { lastVisitAt?: unknown }).lastVisitAt || '').toString().trim();
  const lastVisitStr = ((c as { lastVisitAt?: unknown }).lastVisitAt || '').toString().trim();
  if (lastVisitStr && (!iso || lastVisitStr > iso)) iso = lastVisitStr;
  return iso;
}

/**
 * Лічильники фільтра «Днів» по всій вибірці клієнтів.
 * `excludeFuturePaidRecord` — не рахувати клієнтів із майбутнім платним записом (перемикач «Є запис»).
 */
export function computeGlobalDaysCountsFromClients(
  clientsForDays: ReadonlyArray<Record<string, unknown>>,
  options?: { excludeFuturePaidRecord?: boolean }
): GlobalDaysCounts {
  const daysCounts: GlobalDaysCounts = {
    activeBase: 0,
    inactiveBase: 0,
    consultation: 0,
    none: 0,
    growing: 0,
    grown: 0,
    overgrown: 0,
  };
  const todayKyivDay = kyivDayFromISO(new Date().toISOString());
  const toDayIndex = (day: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
    if (!m) return NaN;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || !mo || !d) return NaN;
    return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  };
  const todayIdx = toDayIndex(todayKyivDay);
  if (!Number.isFinite(todayIdx)) {
    return daysCounts;
  }
  const hasPaidServiceVisit = (c: Record<string, unknown>): boolean => {
    const paidRecords = Number((c as { paidRecordsInHistoryCount?: unknown }).paidRecordsInHistoryCount ?? 0);
    const spent = Number((c as { spent?: unknown }).spent ?? 0);
    return (
      (c as { paidServiceAttended?: unknown }).paidServiceAttended === true ||
      (c as { paidServiceAttendanceValue?: unknown }).paidServiceAttendanceValue === 1 ||
      paidRecords > 0 ||
      spent > 0
    );
  };
  const hasConsultationRecord = (c: Record<string, unknown>): boolean =>
    Boolean(
      (c as { consultationBookingDate?: unknown }).consultationBookingDate ||
        (c as { consultationDate?: unknown }).consultationDate ||
        (c as { consultationAttended?: unknown }).consultationAttended != null ||
        (c as { consultationAttendanceValue?: unknown }).consultationAttendanceValue != null ||
        (c as { consultationCancelled?: unknown }).consultationCancelled === true
    );
  const excludeFuture = options?.excludeFuturePaidRecord === true;
  for (const c of clientsForDays) {
    if (excludeFuture && hasFuturePaidServiceRecord(c as Parameters<typeof hasFuturePaidServiceRecord>[0], todayKyivDay)) {
      continue;
    }
    const hasPaid = hasPaidServiceVisit(c);
    if (!hasPaid && hasConsultationRecord(c)) {
      daysCounts.consultation++;
    }
    const iso = getLastAttendedVisitDate(c as Parameters<typeof getLastAttendedVisitDate>[0]);
    if (!iso) {
      daysCounts.none++;
      if (hasPaid) daysCounts.inactiveBase++;
      continue;
    }
    const day = kyivDayFromISO(iso);
    const idx = toDayIndex(day);
    if (!Number.isFinite(idx)) {
      daysCounts.none++;
      if (hasPaid) daysCounts.inactiveBase++;
      continue;
    }
    const diff = todayIdx - idx;
    const d = diff < 0 ? 0 : diff;
    if (d >= 90) daysCounts.overgrown++;
    else if (d >= 60) daysCounts.grown++;
    else if (d >= 0) daysCounts.growing++;
    else daysCounts.none++;
    if (hasPaid && d >= 0 && d <= 100) daysCounts.activeBase++;
    else if (hasPaid) daysCounts.inactiveBase++;
  }
  return daysCounts;
}
