// web/lib/direct-period-stats.ts
// Обчислення KPI по періодах (з початку місяця, сьогодні, до кінця місяця) зі списку клієнтів.
// Джерело даних — той самий список, що й таблиця (GET /api/admin/direct/clients).

import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

export type PeriodStatsBlock = {
  createdConsultations: number;
  successfulConsultations: number;
  cancelledOrNoShow: number;
  sales: number;
  conversion1Rate?: number;
  conversion2Rate?: number;
  createdPaidSum: number;
  plannedPaidSum: number;
  consultationRescheduledCount: number;
  returnedClientsCount: number;
  consultationCreated?: number;
  consultationOnlineCount?: number;
  consultationPlanned?: number;
  consultationPlannedOnlineCount?: number;
  consultationRealized?: number;
  consultationNoShow?: number;
  consultationCancelled?: number;
  noSaleCount?: number;
  newPaidClients?: number;
  recordsCreatedSum?: number;
  recordsRealizedSum?: number;
  rebookingsCount?: number;
  upsalesGoodsSum?: number;
  newClientsCount?: number;
  noRebookCount?: number;
  recordsCancelledCount?: number;
  recordsNoShowCount?: number;
  turnoverToday?: number;
  consultationPlannedFuture?: number;
  consultationBookedPast?: number;
  consultationBookedPastOnlineCount?: number;
  consultationBookedToday?: number;
  consultationBookedTodayOnlineCount?: number;
  plannedPaidSumFuture?: number;
  plannedPaidSumToMonthEnd?: number;
  plannedPaidSumNextMonth?: number;
  plannedPaidSumPlus2Months?: number;
};

const toKyivDay = (iso?: string | null): string => {
  if (!iso) return '';
  return kyivDayFromISO(String(iso));
};

const getMonthBounds = (todayKyiv: string): { start: string; end: string } => {
  const [y, m] = todayKyiv.split('-');
  const year = Number(y);
  const month = Number(m);
  const monthIndex = Math.max(0, month - 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${pad(lastDay)}` };
};

const getNextMonthBounds = (todayKyiv: string): { start: string; end: string } => {
  const [y, m] = todayKyiv.split('-');
  const year = Number(y);
  const month = Number(m);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(nextYear, nextMonth, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${nextYear}-${pad(nextMonth)}-01`, end: `${nextYear}-${pad(nextMonth)}-${pad(lastDay)}` };
};

const addMonths = (monthKey: string, deltaMonths: number): string => {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1 + deltaMonths, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
};

const getPlus2MonthsBounds = (todayKyiv: string): { start: string; end: string } => {
  const monthKey = todayKyiv.slice(0, 7);
  const plus2Month = addMonths(monthKey, 2);
  const [y, m] = plus2Month.split('-');
  const year = Number(y);
  const month = Number(m);
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${pad(lastDay)}` };
};

const getPaidSum = (client: any): number => {
  const breakdown = Array.isArray(client?.paidServiceVisitBreakdown) ? client.paidServiceVisitBreakdown : null;
  if (breakdown && breakdown.length > 0) {
    return breakdown.reduce((acc: number, b: any) => acc + (Number(b?.sumUAH) || 0), 0);
  }
  const cost = Number(client?.paidServiceTotalCost);
  return Number.isFinite(cost) ? cost : 0;
};

const emptyBlock = (): PeriodStatsBlock => ({
  createdConsultations: 0,
  successfulConsultations: 0,
  cancelledOrNoShow: 0,
  sales: 0,
  createdPaidSum: 0,
  plannedPaidSum: 0,
  consultationRescheduledCount: 0,
  returnedClientsCount: 0,
  consultationCreated: 0,
  consultationOnlineCount: 0,
  consultationPlanned: 0,
  consultationPlannedOnlineCount: 0,
  consultationRealized: 0,
  consultationNoShow: 0,
  consultationCancelled: 0,
  noSaleCount: 0,
  newPaidClients: 0,
  recordsCreatedSum: 0,
  recordsRealizedSum: 0,
  rebookingsCount: 0,
  upsalesGoodsSum: 0,
  newClientsCount: 0,
  noRebookCount: 0,
  recordsCancelledCount: 0,
  recordsNoShowCount: 0,
  turnoverToday: 0,
  consultationPlannedFuture: 0,
  consultationBookedPast: 0,
  consultationBookedPastOnlineCount: 0,
  consultationBookedToday: 0,
  consultationBookedTodayOnlineCount: 0,
  plannedPaidSumFuture: 0,
  plannedPaidSumToMonthEnd: 0,
  plannedPaidSumNextMonth: 0,
  plannedPaidSumPlus2Months: 0,
});

type TodayStats = PeriodStatsBlock & {
  consultationCreated: number;
  consultationOnlineCount: number;
  consultationPlanned: number;
  consultationBookedToday?: number;
  consultationBookedTodayOnlineCount?: number;
  consultationRealized: number;
  consultationNoShow: number;
  consultationCancelled: number;
  noSaleCount: number;
  newPaidClients: number;
  recordsCreatedSum: number;
  recordsRealizedSum: number;
  rebookingsCount: number;
  upsalesGoodsSum: number;
  newClientsCount: number;
  noRebookCount: number;
  consultationRescheduledCount: number;
  returnedClientsCount: number;
  recordsCancelledCount: number;
  recordsNoShowCount: number;
  turnoverToday: number;
};

const emptyTodayBlock = (): TodayStats => ({
  ...emptyBlock(),
  consultationCreated: 0,
  consultationOnlineCount: 0,
  consultationPlanned: 0,
  consultationBookedToday: 0,
  consultationBookedTodayOnlineCount: 0,
  consultationRealized: 0,
  consultationNoShow: 0,
  consultationCancelled: 0,
  noSaleCount: 0,
  newPaidClients: 0,
  recordsCreatedSum: 0,
  recordsRealizedSum: 0,
  rebookingsCount: 0,
  upsalesGoodsSum: 0,
  newClientsCount: 0,
  noRebookCount: 0,
  consultationRescheduledCount: 0,
  returnedClientsCount: 0,
  recordsCancelledCount: 0,
  recordsNoShowCount: 0,
  turnoverToday: 0,
});

export type ComputePeriodStatsOptions = {
  /** Клієнти для обчислення рядка «Заплановано» — без consultAppointedPreset, щоб KPI показував повну картину. */
  clientsForBookedStats?: any[];
};

/**
 * Обчислює KPI по періодах (past, today, future) зі списку клієнтів.
 * Клієнти мають бути вже обогачені (consultationRecordCreatedAt, paidServiceRecordCreatedAt тощо).
 * Якщо передано clientsForBookedStats — рядок «Заплановано» рахується з нього (повна картина без фільтра preset).
 */
export function computePeriodStats(clients: any[], opts?: ComputePeriodStatsOptions): {
  past: PeriodStatsBlock;
  today: TodayStats;
  future: PeriodStatsBlock;
} {
  const todayKyiv = kyivDayFromISO(new Date().toISOString());
  const { start, end } = getMonthBounds(todayKyiv);
  const nextMonthBounds = getNextMonthBounds(todayKyiv);
  const plus2MonthsBounds = getPlus2MonthsBounds(todayKyiv);

  const stats = {
    past: emptyBlock(),
    today: emptyTodayBlock(),
    future: emptyBlock(),
  };

  let consultBookedPast = 0;
  let consultAttendedPast = 0;
  let salesFromConsultPast = 0;
  const newClientsIdsToday = new Set<string>();
  const newClientsIdsPast = new Set<string>();
  const returnedClientIdsPast = new Set<string>();
  const returnedClientIdsToday = new Set<string>();
  const returnedClientIdsFuture = new Set<string>();

  const addByDay = (day: string, apply: (block: PeriodStatsBlock) => void) => {
    if (!day || day < start || day > end) return;
    if (day <= todayKyiv) {
      apply(stats.past);
      if (day === todayKyiv) apply(stats.today);
    } else {
      apply(stats.future);
    }
  };

  for (const client of clients) {
    const visitsCount = typeof client.visits === 'number' ? client.visits : 0;
    const isEligibleSale = client.consultationAttended === true && !!client.paidServiceDate && visitsCount < 2;
    const paidSum = getPaidSum(client);
    const t = stats.today as TodayStats;

    // Блок СТВОРЕНІ (consultationRecordCreatedAt) — окремо від заброньованих. Не чіпати.
    const consultCreatedDay = toKyivDay((client as any).consultationRecordCreatedAt);
    if (consultCreatedDay) {
      addByDay(consultCreatedDay, (b) => {
        b.createdConsultations += 1;
      });
      if (consultCreatedDay >= start && consultCreatedDay <= todayKyiv) {
        stats.past.consultationCreated = (stats.past.consultationCreated || 0) + 1;
        if ((client as any).isOnlineConsultation === true) {
          stats.past.consultationOnlineCount = (stats.past.consultationOnlineCount || 0) + 1;
        }
      }
      if (consultCreatedDay === todayKyiv) {
        t.consultationCreated += 1;
        if ((client as any).isOnlineConsultation === true) t.consultationOnlineCount += 1;
      }
    }

    // Блок ЗАБРОНЬОВАНІ ВІЗИТИ — тільки consultationBookingDate, без consultationRecordCreatedAt.
    // consultationBookedPast, consultationBookedToday, consultationPlannedFuture — виключно з client.consultationBookingDate та isOnlineConsultation.
    const consultDay = toKyivDay(client.consultationBookingDate);
    if (consultDay) {
      addByDay(consultDay, (b) => {
        if (client.consultationAttended === true) b.successfulConsultations += 1;
        else if (client.consultationCancelled || client.consultationAttended === false) b.cancelledOrNoShow += 1;
      });
      const isOnline = (client as any).isOnlineConsultation === true;
      if (consultDay >= start && consultDay < todayKyiv) {
        stats.past.consultationBookedPast = (stats.past.consultationBookedPast || 0) + 1;
        if (isOnline) stats.past.consultationBookedPastOnlineCount = (stats.past.consultationBookedPastOnlineCount || 0) + 1;
      }
      if (consultDay === todayKyiv) {
        (t as TodayStats).consultationBookedToday = ((t as TodayStats).consultationBookedToday || 0) + 1;
        if (isOnline) (t as TodayStats).consultationBookedTodayOnlineCount = ((t as TodayStats).consultationBookedTodayOnlineCount || 0) + 1;
      }
      if (consultDay >= start && consultDay <= todayKyiv) {
        if (client.consultationCancelled) stats.past.consultationCancelled = (stats.past.consultationCancelled || 0) + 1;
        else if (client.consultationAttended === true) stats.past.consultationRealized = (stats.past.consultationRealized || 0) + 1;
        else if (client.consultationAttended === false) stats.past.consultationNoShow = (stats.past.consultationNoShow || 0) + 1;
        else {
          stats.past.consultationPlanned = (stats.past.consultationPlanned || 0) + 1;
          if ((client as any).isOnlineConsultation === true) stats.past.consultationPlannedOnlineCount = (stats.past.consultationPlannedOnlineCount || 0) + 1;
        }
      }
      if (consultDay === todayKyiv) {
        if (client.consultationCancelled) t.consultationCancelled += 1;
        else if (client.consultationAttended === true) t.consultationRealized += 1;
        else if (client.consultationAttended === false) t.consultationNoShow += 1;
        else {
          t.consultationPlanned += 1;
          if ((client as any).isOnlineConsultation === true) (t as PeriodStatsBlock).consultationPlannedOnlineCount = ((t as PeriodStatsBlock).consultationPlannedOnlineCount || 0) + 1;
        }
      }
      if (consultDay > todayKyiv && consultDay <= end) {
        stats.future.consultationPlannedFuture = (stats.future.consultationPlannedFuture || 0) + 1;
        if ((client as any).isOnlineConsultation === true) stats.future.consultationPlannedOnlineCount = (stats.future.consultationPlannedOnlineCount || 0) + 1;
      }
      if (client.state === 'consultation-rescheduled' && consultDay) {
        addByDay(consultDay, (b) => {
          b.consultationRescheduledCount += 1;
        });
        if (consultDay === todayKyiv) t.consultationRescheduledCount += 1;
      }
      if (consultDay >= start && consultDay <= todayKyiv) {
        consultBookedPast += 1;
        if (client.consultationAttended === true) consultAttendedPast += 1;
        if (client.consultationAttended === true && isEligibleSale) salesFromConsultPast += 1;
      }
    }

    const paidDay = toKyivDay(client.paidServiceDate);
    if (isEligibleSale && paidDay) {
      addByDay(paidDay, (b) => {
        b.sales += 1;
      });
    }

    const paidCreatedDay = toKyivDay((client as any).paidServiceRecordCreatedAt) || paidDay;
    if (paidSum > 0 && paidCreatedDay) {
      addByDay(paidCreatedDay, (b) => {
        b.createdPaidSum += paidSum;
      });
      if (paidCreatedDay >= start && paidCreatedDay <= todayKyiv) {
        stats.past.recordsCreatedSum = (stats.past.recordsCreatedSum || 0) + paidSum;
      }
      if (paidCreatedDay === todayKyiv) t.recordsCreatedSum += paidSum;
    }

    if (paidSum > 0 && paidDay) {
      addByDay(paidDay, (b) => {
        b.plannedPaidSum += paidSum;
      });
      if (paidDay >= start && paidDay <= todayKyiv && client.paidServiceAttended === true) {
        stats.past.recordsRealizedSum = (stats.past.recordsRealizedSum || 0) + paidSum;
      }
      if (paidDay === todayKyiv && client.paidServiceAttended === true) t.recordsRealizedSum += paidSum;
      if (paidDay > todayKyiv && paidDay <= end) {
        stats.future.plannedPaidSumFuture = (stats.future.plannedPaidSumFuture || 0) + paidSum;
        stats.future.plannedPaidSumToMonthEnd = (stats.future.plannedPaidSumToMonthEnd || 0) + paidSum;
      } else if (paidDay > end && paidDay >= nextMonthBounds.start && paidDay <= nextMonthBounds.end) {
        stats.future.plannedPaidSumNextMonth = (stats.future.plannedPaidSumNextMonth || 0) + paidSum;
      } else if (paidDay > nextMonthBounds.end && paidDay >= plus2MonthsBounds.start && paidDay <= plus2MonthsBounds.end) {
        stats.future.plannedPaidSumPlus2Months = (stats.future.plannedPaidSumPlus2Months || 0) + paidSum;
      }
    }

    if (paidDay === todayKyiv && (client as any).paidServiceIsRebooking === true) t.rebookingsCount += 1;
    if (paidDay && paidDay >= start && paidDay <= todayKyiv && (client as any).paidServiceIsRebooking === true) {
      stats.past.rebookingsCount = (stats.past.rebookingsCount || 0) + 1;
    }
    if (paidDay && client.paidServiceCancelled === true) {
      if (paidDay >= start && paidDay <= todayKyiv) {
        stats.past.recordsCancelledCount = (stats.past.recordsCancelledCount || 0) + 1;
      }
      if (paidDay === todayKyiv) t.recordsCancelledCount += 1;
    }
    if (paidDay && client.paidServiceAttended === false && !client.paidServiceCancelled) {
      if (paidDay >= start && paidDay <= todayKyiv) {
        stats.past.recordsNoShowCount = (stats.past.recordsNoShowCount || 0) + 1;
      }
      if (paidDay === todayKyiv) t.recordsNoShowCount += 1;
    }

    const isRelevantToday = consultDay === todayKyiv || paidDay === todayKyiv;
    const isRelevantPast = (consultDay && consultDay >= start && consultDay <= todayKyiv) || (paidDay && paidDay >= start && paidDay <= todayKyiv);
    if (isRelevantToday && client.state === 'too-expensive') t.noSaleCount += 1;
    if (isRelevantPast && client.state === 'too-expensive') {
      stats.past.noSaleCount = (stats.past.noSaleCount || 0) + 1;
    }
    if (isRelevantToday && client.state === 'consultation-no-show') t.noRebookCount += 1;
    if (isRelevantPast && client.state === 'consultation-no-show') {
      stats.past.noRebookCount = (stats.past.noRebookCount || 0) + 1;
    }
    if (paidDay === todayKyiv && paidSum > 0 && !client.paidServiceCancelled && client.paidServiceAttended !== false) {
      t.turnoverToday += paidSum;
    }
    if (paidDay && paidDay >= start && paidDay <= todayKyiv && paidSum > 0 && !client.paidServiceCancelled && client.paidServiceAttended !== false) {
      stats.past.turnoverToday = (stats.past.turnoverToday || 0) + paidSum;
    }

    const isHairCategory = (client as any).paidServiceCategory === 'hair-extension' ||
      (typeof (client as any).paidServiceVisitBreakdown === 'object' &&
        Array.isArray((client as any).paidServiceVisitBreakdown) &&
        (client as any).paidServiceVisitBreakdown.some((b: any) => b?.category === 'hair-extension'));
    const goodsSum = !isHairCategory && paidSum > 0 ? paidSum : 0;
    if (paidDay === todayKyiv && goodsSum > 0) t.upsalesGoodsSum += goodsSum;
    if (paidDay && paidDay >= start && paidDay <= todayKyiv && goodsSum > 0) {
      stats.past.upsalesGoodsSum = (stats.past.upsalesGoodsSum || 0) + goodsSum;
    }

    if (visitsCount < 2) {
      if ((consultDay === todayKyiv && client.consultationAttended === true) ||
          (paidDay === todayKyiv && client.paidServiceAttended === true)) {
        newClientsIdsToday.add(client.id);
      }
      if ((consultDay && consultDay >= start && consultDay <= todayKyiv && client.consultationAttended === true) ||
          (paidDay && paidDay >= start && paidDay <= todayKyiv && client.paidServiceAttended === true)) {
        newClientsIdsPast.add(client.id);
      }
    }
    if (visitsCount >= 2) {
      if (consultDay && consultDay >= start && consultDay <= todayKyiv) returnedClientIdsPast.add(client.id);
      if (paidDay && paidDay >= start && paidDay <= todayKyiv) returnedClientIdsPast.add(client.id);
      if (consultDay === todayKyiv || paidDay === todayKyiv) returnedClientIdsToday.add(client.id);
      if (consultDay && consultDay > todayKyiv && consultDay <= end) returnedClientIdsFuture.add(client.id);
      if (paidDay && paidDay > todayKyiv && paidDay <= end) returnedClientIdsFuture.add(client.id);
    }
  }

  stats.today.newClientsCount = newClientsIdsToday.size;
  stats.past.newClientsCount = newClientsIdsPast.size;
  stats.past.returnedClientsCount = returnedClientIdsPast.size;
  stats.today.returnedClientsCount = returnedClientIdsToday.size;
  stats.future.returnedClientsCount = returnedClientIdsFuture.size;
  stats.today.newPaidClients = stats.today.sales;
  stats.past.newPaidClients = stats.past.sales;
  stats.past.conversion1Rate = consultBookedPast > 0 ? (consultAttendedPast / consultBookedPast) * 100 : 0;
  stats.past.conversion2Rate = consultAttendedPast > 0 ? (salesFromConsultPast / consultAttendedPast) * 100 : 0;

  // Якщо передано clientsForBookedStats — рядок «Заплановано» показує повну картину (без consultAppointedPreset).
  if (opts?.clientsForBookedStats && opts.clientsForBookedStats !== clients) {
    let bookedPast = 0, bookedPastOnline = 0, bookedToday = 0, bookedTodayOnline = 0, plannedFuture = 0, plannedFutureOnline = 0;
    for (const client of opts.clientsForBookedStats) {
      const consultDay = toKyivDay(client.consultationBookingDate);
      if (!consultDay) continue;
      const isOnline = (client as any).isOnlineConsultation === true;
      if (consultDay >= start && consultDay < todayKyiv) {
        bookedPast += 1;
        if (isOnline) bookedPastOnline += 1;
      }
      if (consultDay === todayKyiv) {
        bookedToday += 1;
        if (isOnline) bookedTodayOnline += 1;
      }
      if (consultDay > todayKyiv && consultDay <= end) {
        plannedFuture += 1;
        if (isOnline) plannedFutureOnline += 1;
      }
    }
    stats.past.consultationBookedPast = bookedPast;
    stats.past.consultationBookedPastOnlineCount = bookedPastOnline;
    (stats.today as TodayStats).consultationBookedToday = bookedToday;
    (stats.today as TodayStats).consultationBookedTodayOnlineCount = bookedTodayOnline;
    stats.future.consultationPlannedFuture = plannedFuture;
    stats.future.consultationPlannedOnlineCount = plannedFutureOnline;
  }

  return stats;
}
