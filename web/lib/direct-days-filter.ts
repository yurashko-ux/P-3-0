import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import {
  computePaidDaysSinceLastVisitOnKyivDay,
  hasFuturePaidServiceRecordOnKyivDay,
  isActiveBaseOnKyivDay,
  type LastAttendedVisitClient,
} from '@/lib/inactive-base/days-since-last-visit';

/** Клієнт має майбутній платний запис (строго після сьогодні, Europe/Kyiv). Як фільтр «Запис → Майбутні». */
export function hasFuturePaidServiceRecord(
  c: { paidServiceKyivDay?: string | null; paidServiceDate?: string | Date | null; signedUpForPaidService?: boolean | null },
  todayKyiv: string
): boolean {
  return hasFuturePaidServiceRecordOnKyivDay(c, todayKyiv);
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

/**
 * Лічильники фільтра «Днів» по всій вибірці клієнтів (дні — лише з платних послуг).
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
    const client = c as LastAttendedVisitClient;
    const hasPaid = hasPaidServiceVisit(c);
    if (!hasPaid && hasConsultationRecord(c)) {
      daysCounts.consultation++;
    }
    const d = computePaidDaysSinceLastVisitOnKyivDay(client, todayKyivDay);
    if (d === undefined) {
      daysCounts.none++;
      if (hasPaid) daysCounts.inactiveBase++;
      continue;
    }
    if (d >= 90) daysCounts.overgrown++;
    else if (d >= 60) daysCounts.grown++;
    else if (d >= 0) daysCounts.growing++;
    else daysCounts.none++;
    if (hasPaid && isActiveBaseOnKyivDay(client, todayKyivDay)) {
      daysCounts.activeBase++;
    } else if (hasPaid) {
      daysCounts.inactiveBase++;
    }
  }
  return daysCounts;
}
