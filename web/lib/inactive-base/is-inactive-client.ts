// web/lib/inactive-base/is-inactive-client.ts
// Єдиний критерій «неактивна база» (як Direct «Дні → Неактивна база»).

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import {
  ACTIVE_BASE_MAX_DAYS,
  hasScheduledPaidServiceKeepingActiveBaseOnKyivDay,
  type LastAttendedVisitClient,
} from '@/lib/inactive-base/days-since-last-visit';
import {
  inactiveSinceKyivDay,
  isRestoredByFutureBooking,
  type LifecycleClient,
} from '@/lib/inactive-base/lifecycle';

export const INACTIVE_BASE_DAYS_THRESHOLD = ACTIVE_BASE_MAX_DAYS;

export function hasPaidServiceVisitForInactiveBase(c: {
  spent?: number | null;
  paidServiceAttended?: boolean | null;
  paidServiceAttendanceValue?: number | null;
  paidRecordsInHistoryCount?: number | null;
}): boolean {
  const spent = Number(c.spent ?? 0);
  return (
    c.paidServiceAttended === true ||
    c.paidServiceAttendanceValue === 1 ||
    Number(c.paidRecordsInHistoryCount ?? 0) > 0 ||
    spent > 0
  );
}

/** Клієнт у неактивній базі, якщо є платний візит і 101+ днів без майбутнього платного запису (або немає daysSinceLastVisit). */
export function isInactiveBaseByDaysSinceLastVisit(
  c: Parameters<typeof hasPaidServiceVisitForInactiveBase>[0] & LastAttendedVisitClient,
  daysSinceLastVisit: number | undefined,
  referenceKyivDay: string = kyivDayFromISO(new Date().toISOString())
): boolean {
  if (!hasPaidServiceVisitForInactiveBase(c)) return false;
  if (hasScheduledPaidServiceKeepingActiveBaseOnKyivDay(c, referenceKyivDay)) return false;
  if (typeof daysSinceLastVisit !== 'number' || !Number.isFinite(daysSinceLastVisit)) {
    return true;
  }
  return daysSinceLastVisit > INACTIVE_BASE_DAYS_THRESHOLD;
}

/**
 * Список неактивної бази: досі 101+ без запису АБО відновлені майбутнім записом
 * (вже перетнули поріг 101, потім з’явився запис).
 */
export function isInactiveBaseListMember(
  c: Parameters<typeof hasPaidServiceVisitForInactiveBase>[0] & LifecycleClient,
  daysSinceLastVisit: number | undefined,
  referenceKyivDay: string = kyivDayFromISO(new Date().toISOString())
): boolean {
  if (!hasPaidServiceVisitForInactiveBase(c)) return false;
  const since = inactiveSinceKyivDay(c, referenceKyivDay);
  if (!since || since > referenceKyivDay) return false;
  if (isRestoredByFutureBooking(c, referenceKyivDay)) return true;
  return isInactiveBaseByDaysSinceLastVisit(c, daysSinceLastVisit, referenceKyivDay);
}
