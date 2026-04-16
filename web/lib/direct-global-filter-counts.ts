// web/lib/direct-global-filter-counts.ts
// Глобальні лічильники колонкових фільтрів Direct (вся база) — та сама логіка, що filterCountsOnly у route.

import type { DirectClient } from '@/lib/direct-types';
import { getDisplayedState } from '@/lib/direct-displayed-state';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

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
      typeof c.paidServiceDate === 'string'
        ? c.paidServiceDate
        : (c.paidServiceDate as Date)?.toISOString?.() || '';
    if (iso) dates.push(iso);
  }
  let iso = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '';
  if (!iso) iso = ((c as { lastVisitAt?: unknown }).lastVisitAt || '').toString().trim();
  const lastVisitStr = ((c as { lastVisitAt?: unknown }).lastVisitAt || '').toString().trim();
  if (lastVisitStr && (!iso || lastVisitStr > iso)) iso = lastVisitStr;
  return iso;
}

export type GlobalColumnFilterAggregates = {
  daysCounts: { none: number; growing: number; grown: number; overgrown: number };
  stateCounts: Record<string, number>;
  instCounts: Record<string, number>;
  clientTypeCounts: {
    leads: number;
    clients: number;
    consulted: number;
    good: number;
    stars: number;
  };
  consultationCounts: {
    hasConsultation: number;
    createdCur: number;
    createdToday: number;
    appointedCur: number;
    appointedPast: number;
    appointedToday: number;
    appointedFuture: number;
  };
  recordCounts: {
    hasRecord: number;
    newClient: number;
    createdCur: number;
    createdToday: number;
    appointedCur: number;
    appointedPast: number;
    appointedToday: number;
    appointedFuture: number;
  };
  binotelCallsFilterCounts: {
    incoming: number;
    outgoing: number;
    success: number;
    fail: number;
    onlyNew: number;
  };
};

/**
 * Лічильники колонкових фільтрів по повній вибірці клієнтів (як у filterCountsOnly=1).
 */
export function computeGlobalColumnFilterAggregatesFromClients(
  clientsFull: DirectClient[]
): GlobalColumnFilterAggregates {
  const todayKyivDay = kyivDayFromISO(new Date().toISOString());
  const currentMonthKyiv = todayKyivDay.slice(0, 7);
  const toDayIndex = (day: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
    if (!m) return NaN;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || !mo || !d) return NaN;
    return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  };
  const toYyyyMm = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso).slice(0, 7) : '');
  const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');
  const getConsultCreatedAt = (c: DirectClient): string | null | undefined =>
    (c as { consultationRecordCreatedAt?: string | null }).consultationRecordCreatedAt ?? undefined;
  const todayIdx = toDayIndex(todayKyivDay);

  const daysCounts = { none: 0, growing: 0, grown: 0, overgrown: 0 };
  const stateCounts: Record<string, number> = {};
  const instCounts: Record<string, number> = {};
  let clientTypeLeads = 0;
  let clientTypeClients = 0;
  let clientTypeConsulted = 0;
  let clientTypeGood = 0;
  let clientTypeStars = 0;
  let consultationHasConsultation = 0;
  let consultationCreatedCur = 0;
  let consultationCreatedToday = 0;
  let consultationAppointedCur = 0;
  let consultationAppointedPast = 0;
  let consultationAppointedToday = 0;
  let consultationAppointedFuture = 0;
  let recordHasRecord = 0;
  let recordNewClient = 0;
  let recordCreatedCur = 0;
  let recordCreatedToday = 0;
  let recordAppointedCur = 0;
  let recordAppointedPast = 0;
  let recordAppointedToday = 0;
  let recordAppointedFuture = 0;

  for (const c of clientsFull) {
    const iso = getLastAttendedVisitDate(c);
    if (!iso) daysCounts.none++;
    else {
      const day = kyivDayFromISO(iso);
      const idx = toDayIndex(day);
      if (!Number.isFinite(idx)) daysCounts.none++;
      else {
        const diff = todayIdx - idx;
        const d = diff < 0 ? 0 : diff;
        if (d >= 90) daysCounts.overgrown++;
        else if (d >= 60) daysCounts.grown++;
        else if (d >= 0) daysCounts.growing++;
        else daysCounts.none++;
      }
    }
    const state = getDisplayedState(c);
    if (state) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    const chatId = (c as { chatStatusId?: string }).chatStatusId as string | undefined;
    if (chatId && chatId.trim()) instCounts[chatId] = (instCounts[chatId] ?? 0) + 1;
    if (!c.altegioClientId) clientTypeLeads++;
    else {
      clientTypeClients++;
      if ((c.spent ?? 0) === 0) clientTypeConsulted++;
    }
    const spent = c.spent ?? 0;
    if (spent >= 100000) clientTypeStars++;
    else if (spent > 0) clientTypeGood++;
    if (c.consultationBookingDate != null && String(c.consultationBookingDate).trim() !== '')
      consultationHasConsultation++;
    const consultCreatedAt = getConsultCreatedAt(c);
    if (consultCreatedAt) {
      const m = toYyyyMm(consultCreatedAt);
      if (m === currentMonthKyiv) consultationCreatedCur++;
      if (toKyivDay(consultCreatedAt) === todayKyivDay) consultationCreatedToday++;
    }
    if (c.consultationBookingDate) {
      const m = toYyyyMm(c.consultationBookingDate);
      if (m === currentMonthKyiv) consultationAppointedCur++;
      const day = toKyivDay(c.consultationBookingDate);
      if (day && day < todayKyivDay) consultationAppointedPast++;
      else if (day === todayKyivDay) consultationAppointedToday++;
      else if (day && day > todayKyivDay) consultationAppointedFuture++;
    }
    if (c.paidServiceDate != null && String(c.paidServiceDate).trim() !== '') {
      recordHasRecord++;
      if (c.consultationAttended === true) recordNewClient++;
      const recCreated = (c as { paidServiceRecordCreatedAt?: string | Date | null }).paidServiceRecordCreatedAt;
      if (recCreated) {
        const recIso = typeof recCreated === 'string' ? recCreated : (recCreated as Date)?.toISOString?.();
        if (recIso && toYyyyMm(recIso) === currentMonthKyiv) recordCreatedCur++;
        if (recIso && toKyivDay(recIso) === todayKyivDay) recordCreatedToday++;
      }
      const paidDay = toKyivDay(c.paidServiceDate);
      if (paidDay) {
        if (toYyyyMm(c.paidServiceDate) === currentMonthKyiv) recordAppointedCur++;
        if (paidDay < todayKyivDay) recordAppointedPast++;
        else if (paidDay === todayKyivDay) recordAppointedToday++;
        else recordAppointedFuture++;
      }
    }
  }

  const binotelCallsFilterCounts = { incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 };

  return {
    daysCounts,
    stateCounts,
    instCounts,
    clientTypeCounts: {
      leads: clientTypeLeads,
      clients: clientTypeClients,
      consulted: clientTypeConsulted,
      good: clientTypeGood,
      stars: clientTypeStars,
    },
    consultationCounts: {
      hasConsultation: consultationHasConsultation,
      createdCur: consultationCreatedCur,
      createdToday: consultationCreatedToday,
      appointedCur: consultationAppointedCur,
      appointedPast: consultationAppointedPast,
      appointedToday: consultationAppointedToday,
      appointedFuture: consultationAppointedFuture,
    },
    recordCounts: {
      hasRecord: recordHasRecord,
      newClient: recordNewClient,
      createdCur: recordCreatedCur,
      createdToday: recordCreatedToday,
      appointedCur: recordAppointedCur,
      appointedPast: recordAppointedPast,
      appointedToday: recordAppointedToday,
      appointedFuture: recordAppointedFuture,
    },
    binotelCallsFilterCounts,
  };
}
