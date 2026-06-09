/**
 * KPI по періодах (past/today/future) для anchor-дня Kyiv — спільна логіка statsOnly і batch «Ліди».
 */
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import type { DirectClient } from '@/lib/direct-types';
import { computePeriodStats } from '@/lib/direct-period-stats';
import {
  applyMarch2026BulkImportNewLeadsAdjust,
  getTodayKyiv,
  getKyivDayUtcBounds,
} from '@/lib/direct-stats-config';
import { prisma } from '@/lib/prisma';

const toKyivDay = (iso: string | null | undefined): string => (iso ? kyivDayFromISO(iso) : '');

/** Altegio: ігнорувати консультацію лише коли visits >= 2 і немає booking (як у clients API). */
export function applyVisitsConsultDisplayRule(clients: DirectClient[]): DirectClient[] {
  return clients.map((c) => {
    const hadConsult = Boolean((c as { consultationBookingDate?: string }).consultationBookingDate);
    const shouldIgnoreConsult = (c.visits ?? 0) >= 2 && !hadConsult;
    if (shouldIgnoreConsult) {
      return {
        ...c,
        consultationDate: undefined,
        consultationBookingDate: undefined,
        consultationAttended: null,
        consultationCancelled: false,
        consultationMasterId: undefined,
        consultationMasterName: undefined,
        consultationAttemptNumber: undefined,
      };
    }
    return c;
  });
}

export async function computeDirectPeriodStatsForAnchor(params: {
  clients: DirectClient[];
  dayParam?: string | null;
  statsFullPicture?: boolean;
}) {
  const { clients, dayParam, statsFullPicture = true } = params;
  const todayKyivForStats = getTodayKyiv(dayParam);
  const statsMonthKey = todayKyivForStats.slice(0, 7);
  const statsStartOfMonth = `${statsMonthKey}-01`;
  const monthEnd = (() => {
    const [y, m] = statsMonthKey.split('-');
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return `${statsMonthKey}-${String(lastDay).padStart(2, '0')}`;
  })();

  const clientsForBookedStats = clients.filter((c) => {
    const d = toKyivDay(c.consultationBookingDate);
    return !!d && d >= statsStartOfMonth && d <= monthEnd;
  });
  const clientsForStats = statsFullPicture ? clients : clients;
  const periodStats = computePeriodStats(clientsForStats, {
    clientsForBookedStats,
    todayKyiv: todayKyivForStats,
  });

  try {
    const { startUtc: todayStart, endUtc: todayEnd } = getKyivDayUtcBounds(todayKyivForStats);
    const { startUtc: monthStart } = getKyivDayUtcBounds(statsStartOfMonth);
    const [dbToday, dbPast] = await Promise.all([
      prisma.directClient.count({
        where: {
          firstContactDate: { gte: todayStart, lt: todayEnd },
          includeInNewLeadsKpi: true,
        },
      }),
      prisma.directClient.count({
        where: {
          firstContactDate: { gte: monthStart, lt: todayStart },
          includeInNewLeadsKpi: true,
        },
      }),
    ]);
    (periodStats.today as { newLeadsCount?: number }).newLeadsCount = dbToday;
    periodStats.past.newLeadsCount = dbPast;
    const adjLeads = applyMarch2026BulkImportNewLeadsAdjust(
      periodStats.past.newLeadsCount ?? 0,
      (periodStats.today as { newLeadsCount?: number }).newLeadsCount ?? 0,
      todayKyivForStats
    );
    periodStats.past.newLeadsCount = adjLeads.past;
    (periodStats.today as { newLeadsCount?: number }).newLeadsCount = adjLeads.today;
  } catch (err) {
    console.warn('[direct-stats-period-for-anchor] помилка newLeadsCount з БД:', err);
  }

  try {
    const res = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count FROM "direct_client_state_logs"
      WHERE state = 'consultation-rescheduled'
      AND ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyivForStats}::date
    `;
    (periodStats.today as { consultationRescheduledCount?: number }).consultationRescheduledCount = Number(
      res[0]?.count ?? 0
    );
  } catch (err) {
    console.warn('[direct-stats-period-for-anchor] помилка consultationRescheduledCount:', err);
  }

  return { periodStats, todayKyivForStats };
}

/** Чи можна обійти heavy path для statsOnly (лише day / statsFullPicture без фільтрів таблиці). */
export function canUseFastStatsOnlyPath(searchParams: URLSearchParams): boolean {
  if (searchParams.get('statsOnly') !== '1') return false;
  const allowed = new Set(['statsOnly', 'statsFullPicture', 'day', 'debug', '_t', 'secret']);
  for (const [key] of searchParams) {
    if (!allowed.has(key)) return false;
  }
  return true;
}
