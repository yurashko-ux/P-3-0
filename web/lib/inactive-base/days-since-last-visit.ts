// web/lib/inactive-base/days-since-last-visit.ts
// Єдина логіка «останнього візиту» для колонки «Днів», фільтрів і snapshot активної бази.

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

/** Активна база: 0–100 днів включно; випадають лише на 101+ день з останнього візиту. */
export const ACTIVE_BASE_MAX_DAYS = 100;

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

function toIsoString(value: Date | string | null | undefined): string {
  if (!value) return '';
  return (typeof value === 'string' ? value : (value as Date)?.toISOString?.()) || '';
}

/** Altegio: 1 = прийшов; 2 = лише підтвердив запис (ще не візит). */
function countsAsAttendedVisit(attendanceValue: number | null | undefined): boolean {
  if (attendanceValue === 2) return false;
  return true;
}

/**
 * Ефективна дата останнього візиту: max(відвідана консультація, відвідана платна послуга, lastVisitAt).
 * attended=true без коду в БД (старі вебхуки) — вважаємо відвідуванням, якщо не attendance=2.
 */
export function getLastAttendedVisitDate(c: LastAttendedVisitClient): string {
  const dates: string[] = [];
  if (c.consultationAttended === true && countsAsAttendedVisit(c.consultationAttendanceValue)) {
    const iso = toIsoString(c.consultationDate ?? c.consultationBookingDate);
    if (iso) dates.push(iso);
  }
  if (c.paidServiceAttended === true && c.paidServiceDate && countsAsAttendedVisit(c.paidServiceAttendanceValue)) {
    const iso = toIsoString(c.paidServiceDate);
    if (iso) dates.push(iso);
  }
  let iso = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '';
  if (!iso) iso = toIsoString(c.lastVisitAt);
  const lastVisitStr = toIsoString(c.lastVisitAt);
  // lastVisitAt з вебхука (attendance=1) часто новіший за застаріле paidServiceDate в БД
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

export function computeActiveBaseDaysOnKyivDay(
  client: LastAttendedVisitClient,
  snapshotKyivDay: string
): number | undefined {
  const iso = getLastAttendedVisitDate(client);
  if (!iso) return undefined;
  return computeDaysSinceLastVisitOnKyivDay(iso, snapshotKyivDay);
}

/** Активна база: 0–100 днів з останнього візиту на дату snapshot (Kyiv). */
export function isActiveBaseOnKyivDay(
  client: LastAttendedVisitClient,
  snapshotKyivDay: string,
  maxDays = ACTIVE_BASE_MAX_DAYS
): boolean {
  const days = computeActiveBaseDaysOnKyivDay(client, snapshotKyivDay);
  return days !== undefined && days >= 0 && days <= maxDays;
}

/** Випав з активної бази саме через поріг 100 днів (101+ на currKyivDay). */
export function didLeaveActiveBaseByThreshold(
  client: LastAttendedVisitClient,
  prevKyivDay: string,
  currKyivDay: string
): boolean {
  const daysPrev = computeActiveBaseDaysOnKyivDay(client, prevKyivDay);
  const daysCurr = computeActiveBaseDaysOnKyivDay(client, currKyivDay);
  return (
    daysPrev !== undefined &&
    daysCurr !== undefined &&
    daysPrev <= ACTIVE_BASE_MAX_DAYS &&
    daysCurr > ACTIVE_BASE_MAX_DAYS
  );
}

/** Повернувся в активну базу (новий візит або зменшення днів до ≤100). */
export function didJoinActiveBaseByThreshold(
  client: LastAttendedVisitClient,
  prevKyivDay: string,
  currKyivDay: string
): boolean {
  const daysPrev = computeActiveBaseDaysOnKyivDay(client, prevKyivDay);
  const daysCurr = computeActiveBaseDaysOnKyivDay(client, currKyivDay);
  return (
    daysCurr !== undefined &&
    daysCurr <= ACTIVE_BASE_MAX_DAYS &&
    (daysPrev === undefined || daysPrev > ACTIVE_BASE_MAX_DAYS)
  );
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
