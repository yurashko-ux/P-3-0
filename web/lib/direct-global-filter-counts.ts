// web/lib/direct-global-filter-counts.ts
// Глобальні лічильники колонкових фільтрів Direct (вся база) — та сама логіка, що filterCountsOnly у route.

import type { DirectClient } from '@/lib/direct-types';
import { getDisplayedState } from '@/lib/direct-displayed-state';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import {
  computePaidDaysSinceLastVisitOnKyivDay,
  isActiveBaseOnKyivDay,
  type LastAttendedVisitClient,
} from '@/lib/inactive-base/days-since-last-visit';

/** Порожні лічильники, коли skipPanelCounts=1 — панель оновить окремий запит filterCountsOnly. */
export function emptyGlobalColumnFilterAggregates(): GlobalColumnFilterAggregates {
  return {
    daysCounts: { activeBase: 0, inactiveBase: 0, consultation: 0, none: 0, growing: 0, grown: 0, overgrown: 0 },
    stateCounts: {},
    instCounts: {},
    instInstagramCounts: { has: 0, missing: 0 },
    clientTypeCounts: {
      leads: 0,
      clients: 0,
      consulted: 0,
      good: 0,
      stars: 0,
    },
    consultationCounts: {
      hasConsultation: 0,
      createdCur: 0,
      createdToday: 0,
      appointedCur: 0,
      appointedPast: 0,
      appointedToday: 0,
      appointedFuture: 0,
    },
    recordCounts: {
      hasRecord: 0,
      newClient: 0,
      createdCur: 0,
      createdToday: 0,
      appointedCur: 0,
      appointedPast: 0,
      appointedToday: 0,
      appointedFuture: 0,
    },
    binotelCallsFilterCounts: { incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 },
  };
}

export type GlobalColumnFilterAggregates = {
  daysCounts: {
    activeBase: number;
    inactiveBase: number;
    consultation: number;
    none: number;
    growing: number;
    grown: number;
    overgrown: number;
  };
  stateCounts: Record<string, number>;
  instCounts: Record<string, number>;
  instInstagramCounts: { has: number; missing: number };
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
  const toYyyyMm = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso).slice(0, 7) : '');
  const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');
  const getConsultCreatedAt = (c: DirectClient): string | null | undefined =>
    (c as { consultationRecordCreatedAt?: string | null }).consultationRecordCreatedAt ?? undefined;

  const daysCounts = { activeBase: 0, inactiveBase: 0, consultation: 0, none: 0, growing: 0, grown: 0, overgrown: 0 };
  const stateCounts: Record<string, number> = {};
  const instCounts: Record<string, number> = {};
  let instInstagramHas = 0;
  let instInstagramMissing = 0;
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
    const paidRecords = Number((c as { paidRecordsInHistoryCount?: unknown }).paidRecordsInHistoryCount ?? 0);
    const paidSpent = Number(c.spent ?? 0);
    const hasPaidServiceVisit =
      c.paidServiceAttended === true || c.paidServiceAttendanceValue === 1 || paidRecords > 0 || paidSpent > 0;
    const hasConsultationRecord = Boolean(
      c.consultationBookingDate ||
        c.consultationDate ||
        c.consultationAttended != null ||
        c.consultationAttendanceValue != null ||
        c.consultationCancelled === true
    );
    if (!hasPaidServiceVisit && hasConsultationRecord) daysCounts.consultation++;
    const client = c as LastAttendedVisitClient;
    const d = computePaidDaysSinceLastVisitOnKyivDay(client, todayKyivDay);
    if (d === undefined) {
      daysCounts.none++;
      if (hasPaidServiceVisit && isActiveBaseOnKyivDay(client, todayKyivDay)) {
        daysCounts.activeBase++;
      } else if (hasPaidServiceVisit) {
        daysCounts.inactiveBase++;
      }
    } else {
      if (d >= 90) daysCounts.overgrown++;
      else if (d >= 60) daysCounts.grown++;
      else if (d >= 0) daysCounts.growing++;
      else daysCounts.none++;
      if (hasPaidServiceVisit && isActiveBaseOnKyivDay(client, todayKyivDay)) {
        daysCounts.activeBase++;
      } else if (hasPaidServiceVisit) {
        daysCounts.inactiveBase++;
      }
    }
    const state = getDisplayedState(c);
    if (state) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    const chatId = (c as { chatStatusId?: string }).chatStatusId as string | undefined;
    if (chatId && chatId.trim()) instCounts[chatId] = (instCounts[chatId] ?? 0) + 1;
    if (hasNormalInstagramUsername(c.instagramUsername)) instInstagramHas++;
    else instInstagramMissing++;
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
    instInstagramCounts: { has: instInstagramHas, missing: instInstagramMissing },
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
