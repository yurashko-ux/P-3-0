// web/lib/inactive-base/is-inactive-client.ts
// Єдиний критерій «неактивна база» (як Direct «Дні → Неактивна база»).

import { ACTIVE_BASE_MAX_DAYS } from '@/lib/inactive-base/days-since-last-visit';

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

/** Клієнт у неактивній базі, якщо є платний візит і 101+ днів (або немає daysSinceLastVisit). */
export function isInactiveBaseByDaysSinceLastVisit(
  c: Parameters<typeof hasPaidServiceVisitForInactiveBase>[0],
  daysSinceLastVisit: number | undefined
): boolean {
  if (!hasPaidServiceVisitForInactiveBase(c)) return false;
  if (typeof daysSinceLastVisit !== 'number' || !Number.isFinite(daysSinceLastVisit)) {
    return true;
  }
  return daysSinceLastVisit > INACTIVE_BASE_DAYS_THRESHOLD;
}
