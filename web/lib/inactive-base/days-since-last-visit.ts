// web/lib/inactive-base/days-since-last-visit.ts
// Єдина логіка «останнього візиту» для колонки «Днів», фільтрів і snapshot активної бази.

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

export type LastAttendedVisitClient = {
  consultationAttended?: boolean | null;
  consultationAttendanceValue?: number | null;
  consultationDate?: Date | string | null;
  consultationBookingDate?: Date | string | null;
  paidServiceAttended?: boolean | null;
  paidServiceAttendanceValue?: number | null;
  paidServiceDate?: Date | string | null;
  lastVisitAt?: Date | string | null;
};

/**
 * Ефективна дата останнього візиту: max(відвідана консультація, відвідана платна послуга, lastVisitAt).
 * Та сама логіка, що в direct/clients і фільтрі «Днів».
 */
export function getLastAttendedVisitDate(c: LastAttendedVisitClient): string {
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
  if (!iso) iso = (c.lastVisitAt || '').toString().trim();
  const lastVisitStr = (c.lastVisitAt || '').toString().trim();
  if (lastVisitStr && (!iso || lastVisitStr > iso)) iso = lastVisitStr;
  return iso;
}

function toDayIndex(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return NaN;
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

/** Днів між датою візиту (ISO) і опорним днем Kyiv (включно з 0). */
export function computeDaysSinceLastVisitOnKyivDay(
  lastVisitIso: string,
  referenceKyivDay: string
): number | undefined {
  const day = kyivDayFromISO(lastVisitIso);
  const refIdx = toDayIndex(referenceKyivDay);
  const lastIdx = toDayIndex(day);
  if (!Number.isFinite(refIdx) || !Number.isFinite(lastIdx)) return undefined;
  const diff = refIdx - lastIdx;
  return diff < 0 ? 0 : diff;
}

/** Активна база: 0–100 днів з останнього візиту на дату snapshot (Kyiv). */
export function isActiveBaseOnKyivDay(
  client: LastAttendedVisitClient,
  snapshotKyivDay: string,
  maxDays = 100
): boolean {
  const iso = getLastAttendedVisitDate(client);
  if (!iso) return false;
  const days = computeDaysSinceLastVisitOnKyivDay(iso, snapshotKyivDay);
  return days !== undefined && days >= 0 && days <= maxDays;
}

export function computeDaysSinceLastVisit<T extends Record<string, unknown>>(
  clients: T[]
): (T & { daysSinceLastVisit?: number })[] {
  try {
    const todayKyivDay = kyivDayFromISO(new Date().toISOString());
    return clients.map((c) => {
      const iso = getLastAttendedVisitDate(c as LastAttendedVisitClient);
      if (!iso) {
        return { ...c, daysSinceLastVisit: undefined };
      }
      const daysSinceLastVisit = computeDaysSinceLastVisitOnKyivDay(iso, todayKyivDay);
      return { ...c, daysSinceLastVisit };
    });
  } catch (err) {
    console.warn('[inactive-base] Не вдалося порахувати daysSinceLastVisit:', err);
    return clients as (T & { daysSinceLastVisit?: number })[];
  }
}
