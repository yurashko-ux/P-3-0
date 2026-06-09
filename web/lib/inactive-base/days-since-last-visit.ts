// web/lib/inactive-base/days-since-last-visit.ts
// Єдина логіка «днів з останнього візиту» (лише платні) для колонки «Днів», фільтрів і snapshot активної бази.

import {
  computeServicesTotalCostUAH,
  kyivDayFromISO,
  type RecordGroup,
} from '@/lib/altegio/records-grouping';

/** Активна база: 0–100 днів включно; випадають лише на 101+ день з останнього візиту (якщо немає майбутнього запису). */
export const ACTIVE_BASE_MAX_DAYS = 100;

export type LastAttendedVisitClient = {
  consultationAttended?: boolean | null;
  consultationAttendanceValue?: number | null;
  consultationDate?: Date | string | null;
  consultationBookingDate?: Date | string | null;
  consultationBookingKyivDay?: string | null;
  consultationCancelled?: boolean | null;
  paidServiceAttended?: boolean | null;
  paidServiceAttendanceValue?: number | null;
  paidServiceDate?: Date | string | null;
  paidServiceKyivDay?: string | null;
  signedUpForPaidService?: boolean | null;
  lastVisitAt?: Date | string | null;
};

function resolveBookingKyivDay(
  kyivDayField: string | null | undefined,
  dateField: Date | string | null | undefined
): string {
  const kyiv = (kyivDayField ?? '').trim();
  if (kyiv) return kyiv;
  const iso = toIsoString(dateField);
  return iso ? kyivDayFromISO(iso) : '';
}

/** Майбутній платний запис (строго після referenceKyivDay, Europe/Kyiv). */
export function hasFuturePaidServiceRecordOnKyivDay(
  c: Pick<LastAttendedVisitClient, 'paidServiceKyivDay' | 'paidServiceDate' | 'signedUpForPaidService'>,
  referenceKyivDay: string
): boolean {
  if (c.signedUpForPaidService === false) return false;
  const day = resolveBookingKyivDay(c.paidServiceKyivDay, c.paidServiceDate);
  if (!day) return false;
  return day > referenceKyivDay;
}

/** Майбутня консультація (строго після referenceKyivDay, Europe/Kyiv). */
export function hasFutureConsultationOnKyivDay(
  c: Pick<
    LastAttendedVisitClient,
    'consultationBookingKyivDay' | 'consultationBookingDate' | 'consultationCancelled'
  >,
  referenceKyivDay: string
): boolean {
  if (c.consultationCancelled === true) return false;
  const day = resolveBookingKyivDay(c.consultationBookingKyivDay, c.consultationBookingDate);
  if (!day) return false;
  return day > referenceKyivDay;
}

/** @deprecated Використовуйте hasFuturePaidServiceRecordOnKyivDay — активна база лише по платних. */
export function hasFutureAppointmentOnKyivDay(
  c: LastAttendedVisitClient,
  referenceKyivDay: string
): boolean {
  return hasFuturePaidServiceRecordOnKyivDay(c, referenceKyivDay);
}

function toIsoString(value: Date | string | null | undefined): string {
  if (!value) return '';
  return (typeof value === 'string' ? value : (value as Date)?.toISOString?.()) || '';
}

/** Altegio: 1 = прийшов; 2 = лише підтвердив запис (ще не візит). */
function countsAsAttendedVisit(attendanceValue: number | null | undefined): boolean {
  if (attendanceValue === 2) return false;
  return true;
}

/** Чи дата походить лише з консультації (без платного візиту на той самий або новіший день). */
function isConsultationOnlyVisitDate(
  c: LastAttendedVisitClient,
  iso: string,
  refDay: string
): boolean {
  const isoDay = kyivDayFromISO(iso);
  if (!isoDay || isoDay > refDay) return true;

  if (
    c.paidServiceAttended === true &&
    c.paidServiceDate &&
    countsAsAttendedVisit(c.paidServiceAttendanceValue)
  ) {
    const paidIso = toIsoString(c.paidServiceDate);
    const paidDay = paidIso ? kyivDayFromISO(paidIso) : '';
    if (paidDay && paidDay <= refDay && paidDay >= isoDay) return false;
  }

  if (c.consultationAttended !== true) return false;
  const consultIso = toIsoString(c.consultationDate ?? c.consultationBookingDate);
  const consultDay = consultIso ? kyivDayFromISO(consultIso) : '';
  return consultDay === isoDay;
}

/**
 * Дата останнього платного візиту для колонки «Днів», фільтрів і активної бази.
 * 1) Відвіданий платний запис (paidServiceAttended + attendance=1 + дата ≤ refDay).
 * 2) lastVisitAt з Altegio (якщо ≤ refDay).
 * 3) getLastAttendedVisitDate, якщо це не лише консультація.
 */
export function getLastPaidServiceVisitDate(
  c: LastAttendedVisitClient,
  referenceKyivDay?: string
): string {
  const refDay = /^\d{4}-\d{2}-\d{2}$/.test((referenceKyivDay || '').trim())
    ? (referenceKyivDay as string).trim()
    : kyivDayFromISO(new Date().toISOString());

  if (
    c.paidServiceAttended === true &&
    c.paidServiceDate &&
    countsAsAttendedVisit(c.paidServiceAttendanceValue)
  ) {
    const iso = toIsoString(c.paidServiceDate);
    const day = iso ? kyivDayFromISO(iso) : '';
    if (day && day <= refDay) return iso;
  }

  const lastVisitStr = toIsoString(c.lastVisitAt);
  const lastVisitDay = lastVisitStr ? kyivDayFromISO(lastVisitStr) : '';
  if (
    lastVisitDay &&
    lastVisitDay <= refDay &&
    !isConsultationOnlyVisitDate(c, lastVisitStr, refDay)
  ) {
    return lastVisitStr;
  }

  const merged = getLastAttendedVisitDate(c);
  if (merged) {
    const mergedDay = kyivDayFromISO(merged);
    if (mergedDay && mergedDay <= refDay && !isConsultationOnlyVisitDate(c, merged, refDay)) {
      return merged;
    }
  }

  return '';
}

/**
 * Ефективна дата останнього візиту: max(відвідана консультація, відвідана платна послуга, lastVisitAt).
 * Для фільтрів «Днів» і активної бази не використовується — лише getLastPaidServiceVisitDate.
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

/** Днів між двома Kyiv-днями (включно з 0). */
export function computeDaysBetweenKyivDays(
  lastKyivDay: string,
  referenceKyivDay: string
): number | undefined {
  const refIdx = toDayIndex(referenceKyivDay);
  const lastIdx = toDayIndex(lastKyivDay);
  if (!Number.isFinite(refIdx) || !Number.isFinite(lastIdx)) return undefined;
  const diff = refIdx - lastIdx;
  return diff < 0 ? 0 : diff;
}

/** Днів між датою візиту (ISO) і опорним днем Kyiv (включно з 0). */
export function computeDaysSinceLastVisitOnKyivDay(
  lastVisitIso: string,
  referenceKyivDay: string
): number | undefined {
  const day = kyivDayFromISO(lastVisitIso);
  if (!day) return undefined;
  return computeDaysBetweenKyivDays(day, referenceKyivDay);
}

/** Чи група Altegio — минулий платний візит (як у «Історії записів»). */
export function countsAsPastPaidVisitGroup(g: RecordGroup, referenceKyivDay: string): boolean {
  if (g.groupType !== 'paid') return false;
  const day = (g.kyivDay || '').trim();
  if (!day || day > referenceKyivDay) return false;
  if (g.attendance === -2 || g.attendanceStatus === 'cancelled') return false;
  if (g.attendance === -1 || g.attendanceStatus === 'no-show') return false;
  if (g.attendance === 1 || g.attendanceStatus === 'arrived') return true;
  return computeServicesTotalCostUAH(g.services || []) > 0;
}

/** Останній минулий платний візит з груп Altegio/KV. */
export function pickLatestPastPaidVisitGroup(
  groups: RecordGroup[],
  referenceKyivDay: string
): RecordGroup | null {
  const paid = groups
    .filter((g) => countsAsPastPaidVisitGroup(g, referenceKyivDay))
    .sort((a, b) => (b.kyivDay || '').localeCompare(a.kyivDay || ''));
  return paid[0] ?? null;
}

/** Днів з останнього платного візиту: спочатку групи Altegio, інакше поля Prisma. */
export function computePaidDaysSinceLastVisitOnKyivDay(
  client: LastAttendedVisitClient,
  referenceKyivDay: string,
  recordGroups?: RecordGroup[]
): number | undefined {
  if (recordGroups?.length) {
    const pastPaid = pickLatestPastPaidVisitGroup(recordGroups, referenceKyivDay);
    if (pastPaid?.kyivDay) {
      const days = computeDaysBetweenKyivDays(pastPaid.kyivDay, referenceKyivDay);
      if (days !== undefined) return days;
    }
  }
  const iso = getLastPaidServiceVisitDate(client, referenceKyivDay);
  if (!iso) return undefined;
  return computeDaysSinceLastVisitOnKyivDay(iso, referenceKyivDay);
}

/** Колонка «Днів» з груп Altegio/KV (той самий джерело, що «Історія записів»). */
export function enrichClientsDaysFromRecordGroups<
  T extends { id: string; altegioClientId?: number | null; daysSinceLastVisit?: number },
>(
  clients: T[],
  groupsByClient: Map<number, RecordGroup[]>,
  referenceKyivDay?: string
): T[] {
  const refDay = /^\d{4}-\d{2}-\d{2}$/.test((referenceKyivDay || '').trim())
    ? (referenceKyivDay as string).trim()
    : kyivDayFromISO(new Date().toISOString());

  return clients.map((c) => {
    const altegioId = Number(c.altegioClientId);
    if (!Number.isFinite(altegioId)) return c;
    const groups = groupsByClient.get(altegioId) || [];
    const daysSinceLastVisit = computePaidDaysSinceLastVisitOnKyivDay(
      c as LastAttendedVisitClient,
      refDay,
      groups
    );
    return { ...c, daysSinceLastVisit } as T;
  });
}

export function computeActiveBaseDaysOnKyivDay(
  client: LastAttendedVisitClient,
  snapshotKyivDay: string
): number | undefined {
  return computePaidDaysSinceLastVisitOnKyivDay(client, snapshotKyivDay);
}

/**
 * Активна база на дату snapshot (Kyiv):
 * 0–100 днів з останнього платного візиту АБО майбутній платний запис.
 */
export function isActiveBaseOnKyivDay(
  client: LastAttendedVisitClient,
  snapshotKyivDay: string,
  maxDays = ACTIVE_BASE_MAX_DAYS
): boolean {
  if (hasFuturePaidServiceRecordOnKyivDay(client, snapshotKyivDay)) {
    return true;
  }
  const days = computeActiveBaseDaysOnKyivDay(client, snapshotKyivDay);
  return days !== undefined && days >= 0 && days <= maxDays;
}

/** Випав з активної бази (поріг 100 днів або зник майбутній запис). */
export function didLeaveActiveBaseByThreshold(
  client: LastAttendedVisitClient,
  prevKyivDay: string,
  currKyivDay: string
): boolean {
  return isActiveBaseOnKyivDay(client, prevKyivDay) && !isActiveBaseOnKyivDay(client, currKyivDay);
}

/** Повернувся в активну базу (новий візит, запис або зменшення днів до ≤100). */
export function didJoinActiveBaseByThreshold(
  client: LastAttendedVisitClient,
  prevKyivDay: string,
  currKyivDay: string
): boolean {
  return !isActiveBaseOnKyivDay(client, prevKyivDay) && isActiveBaseOnKyivDay(client, currKyivDay);
}

export function computeDaysSinceLastVisit<T extends Record<string, unknown>>(
  clients: T[]
): (T & { daysSinceLastVisit?: number })[] {
  try {
    const todayKyivDay = kyivDayFromISO(new Date().toISOString());
    return clients.map((c) => {
      const daysSinceLastVisit = computePaidDaysSinceLastVisitOnKyivDay(
        c as LastAttendedVisitClient,
        todayKyivDay
      );
      return { ...c, daysSinceLastVisit };
    });
  } catch (err) {
    console.warn('[inactive-base] Не вдалося порахувати daysSinceLastVisit:', err);
    return clients as (T & { daysSinceLastVisit?: number })[];
  }
}
