// web/lib/inactive-base/lifecycle.ts
// Дата виходу на неактивність (visit+101), відновлення майбутнім платним записом, enrich для UI.

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import {
  ACTIVE_BASE_MAX_DAYS,
  computePaidDaysSinceLastVisitOnKyivDay,
  getLastPaidServiceVisitDate,
  hasScheduledPaidServiceKeepingActiveBaseOnKyivDay,
  type LastAttendedVisitClient,
} from '@/lib/inactive-base/days-since-last-visit';
import type { RecordGroup } from '@/lib/altegio/records-grouping';

export type InactiveLifecycleStatus = 'active' | 'inactive' | 'restored';

export type LifecycleClient = LastAttendedVisitClient & {
  id?: string;
  paidServiceRecordCreatedAt?: Date | string | null;
};

/** Додати N днів до YYYY-MM-DD (календарно, UTC-дата = Kyiv day string). */
export function addKyivDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toISOString?.() || '';
}

/**
 * Дата виходу на неактивність: останній платний візит (Kyiv) + 101 день.
 * null — якщо немає платного візиту.
 */
export function inactiveSinceKyivDay(
  client: LifecycleClient,
  referenceKyivDay?: string,
  recordGroups?: RecordGroup[]
): string | null {
  const ref =
    /^\d{4}-\d{2}-\d{2}$/.test((referenceKyivDay || '').trim())
      ? (referenceKyivDay as string).trim()
      : kyivDayFromISO(new Date().toISOString());

  if (recordGroups?.length) {
    const days = computePaidDaysSinceLastVisitOnKyivDay(client, ref, recordGroups);
    if (days !== undefined && days >= 0) {
      // visitDay = ref - days; inactiveSince = visitDay + 101 = ref - days + 101
      return addKyivDays(ref, ACTIVE_BASE_MAX_DAYS + 1 - days);
    }
  }

  const iso = getLastPaidServiceVisitDate(client, ref);
  if (!iso) return null;
  const visitDay = kyivDayFromISO(iso);
  if (!visitDay) return null;
  return addKyivDays(visitDay, ACTIVE_BASE_MAX_DAYS + 1);
}

/**
 * День відновлення: коли створено майбутній платний запис (або день запису).
 */
export function restoredAtKyivDay(client: LifecycleClient): string | null {
  const createdIso = toIso(client.paidServiceRecordCreatedAt);
  if (createdIso) {
    const day = kyivDayFromISO(createdIso);
    if (day) return day;
  }
  const booking =
    (client.paidServiceKyivDay || '').trim() ||
    (client.paidServiceDate ? kyivDayFromISO(toIso(client.paidServiceDate)) : '');
  return booking || null;
}

/**
 * Був би 101+ без запису, але є запланований платний запис, що тримає в активній базі,
 * і цей запис з’явився не раніше дати виходу (інакше клієнт ніколи не випадав).
 */
export function isRestoredByFutureBooking(
  client: LifecycleClient,
  todayKyiv: string,
  recordGroups?: RecordGroup[]
): boolean {
  const inactiveSince = inactiveSinceKyivDay(client, todayKyiv, recordGroups);
  if (!inactiveSince || inactiveSince > todayKyiv) return false;
  if (!hasScheduledPaidServiceKeepingActiveBaseOnKyivDay(client, todayKyiv)) return false;
  const restoredAt = restoredAtKyivDay(client);
  // Запис до дня виходу → клієнт не переходив у неактивну
  if (restoredAt && restoredAt < inactiveSince) return false;
  return true;
}

/** Чи зараз у неактивній базі (101+ і немає keeping-запису). */
export function isCurrentlyInactive(
  client: LifecycleClient,
  todayKyiv: string,
  recordGroups?: RecordGroup[]
): boolean {
  if (hasScheduledPaidServiceKeepingActiveBaseOnKyivDay(client, todayKyiv)) return false;
  const days = computePaidDaysSinceLastVisitOnKyivDay(client, todayKyiv, recordGroups);
  return days !== undefined && days > ACTIVE_BASE_MAX_DAYS;
}

export function resolveInactiveLifecycleStatus(
  client: LifecycleClient,
  todayKyiv: string,
  recordGroups?: RecordGroup[]
): InactiveLifecycleStatus {
  if (isRestoredByFutureBooking(client, todayKyiv, recordGroups)) return 'restored';
  if (isCurrentlyInactive(client, todayKyiv, recordGroups)) return 'inactive';
  return 'active';
}

/**
 * Значення для колонки «Днів» (бейджі Н/А / ✓):
 * - restored → 0 + дата відновлення
 * - inactive → поточні дні + дата виходу (inactiveSince)
 */
export function buildExitDaysDisplay(
  client: LifecycleClient,
  todayKyiv: string,
  recordGroups?: RecordGroup[]
): {
  status: InactiveLifecycleStatus;
  exitDays: number | null;
  inactiveSinceKyivDay: string | null;
  restoredAtKyivDay: string | null;
  liveDays: number | undefined;
} {
  const liveDays = computePaidDaysSinceLastVisitOnKyivDay(client, todayKyiv, recordGroups);
  const inactiveSince = inactiveSinceKyivDay(client, todayKyiv, recordGroups);
  const restoredAt = restoredAtKyivDay(client);
  const status = resolveInactiveLifecycleStatus(client, todayKyiv, recordGroups);

  if (status === 'restored') {
    return {
      status,
      exitDays: 0,
      inactiveSinceKyivDay: inactiveSince,
      restoredAtKyivDay: restoredAt,
      liveDays,
    };
  }

  if (status === 'inactive') {
    return {
      status,
      exitDays: typeof liveDays === 'number' ? liveDays : null,
      inactiveSinceKyivDay: inactiveSince,
      restoredAtKyivDay: null,
      liveDays,
    };
  }

  return {
    status,
    exitDays: typeof liveDays === 'number' ? liveDays : null,
    inactiveSinceKyivDay: inactiveSince,
    restoredAtKyivDay: null,
    liveDays,
  };
}

export function enrichClientWithLifecycle<T extends LifecycleClient & { id: string }>(
  client: T,
  todayKyiv: string,
  recordGroups?: RecordGroup[]
): T & {
  inactiveLifecycleStatus: InactiveLifecycleStatus;
  inactiveSinceKyivDay: string | null;
  restoredAtKyivDay: string | null;
  exitDaysDisplay: number | null;
  liveDaysSinceLastVisit: number | undefined;
} {
  const d = buildExitDaysDisplay(client, todayKyiv, recordGroups);
  return {
    ...client,
    inactiveLifecycleStatus: d.status,
    inactiveSinceKyivDay: d.inactiveSinceKyivDay,
    restoredAtKyivDay: d.restoredAtKyivDay,
    exitDaysDisplay: d.exitDays,
    liveDaysSinceLastVisit: d.liveDays,
  };
}
