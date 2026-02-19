// web/lib/direct-stats-engine.ts
// Єдиний модуль підрахунку статистики Direct.
// Кожна метрика має чітке визначення. Нова метрика = одна функція.

import { isPlaceholderUsername, toKyivDay } from '@/lib/direct-stats-config';

export type StatsBlock = {
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
  newLeadsCount?: number;
  noRebookCount?: number;
  recordsCancelledCount?: number;
  recordsNoShowCount?: number;
  recordsRestoredCount?: number;
  paidPastNoRebookCount?: number;
  turnoverToday?: number;
  consultationPlannedFuture?: number;
  consultationBookedPast?: number;
  consultationBookedPastOnlineCount?: number;
  consultationBookedToday?: number;
  consultationBookedTodayOnlineCount?: number;
  consultationPlannedOnlineCount?: number;
  plannedPaidSumFuture?: number;
  plannedPaidSumToMonthEnd?: number;
  plannedPaidSumNextMonth?: number;
  plannedPaidSumPlus2Months?: number;
};

export type TodayStats = StatsBlock & {
  consultationCreated: number;
  consultationOnlineCount: number;
  consultationPlanned: number;
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
  newLeadsCount: number;
  noRebookCount: number;
  consultationRescheduledCount: number;
  returnedClientsCount: number | null;
  recordsCancelledCount: number;
  recordsNoShowCount: number;
  recordsRestoredCount: number;
  paidPastNoRebookCount: number;
  turnoverToday: number;
};

export type KvTodayCounts = {
  consultationCreated: number;
  recordsCreatedSum: number;
  rebookingsCount: number;
};

export type ComputePeriodStatsOptions = {
  todayKyiv: string;
  start: string;
  end: string;
  nextMonthBounds: { start: string; end: string };
  plus2MonthsBounds: { start: string; end: string };
  kvTodayCounts: KvTodayCounts;
};

const emptyBlock = (): StatsBlock => ({
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
  newLeadsCount: 0,
  noRebookCount: 0,
  recordsCancelledCount: 0,
  recordsNoShowCount: 0,
  recordsRestoredCount: 0,
  paidPastNoRebookCount: 0,
  turnoverToday: 0,
  consultationPlannedFuture: 0,
  consultationBookedPast: 0,
  consultationBookedPastOnlineCount: 0,
  consultationBookedToday: 0,
  consultationBookedTodayOnlineCount: 0,
  consultationPlannedOnlineCount: 0,
  plannedPaidSumFuture: 0,
  plannedPaidSumToMonthEnd: 0,
  plannedPaidSumNextMonth: 0,
  plannedPaidSumPlus2Months: 0,
});

function emptyTodayBlock(): TodayStats {
  return {
    ...emptyBlock(),
    consultationCreated: 0,
    consultationOnlineCount: 0,
    consultationPlanned: 0,
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
    newLeadsCount: 0,
    noRebookCount: 0,
    consultationRescheduledCount: 0,
    returnedClientsCount: 0,
    recordsCancelledCount: 0,
    recordsNoShowCount: 0,
    recordsRestoredCount: 0,
    paidPastNoRebookCount: 0,
    turnoverToday: 0,
  };
}

function getPaidSum(client: any): number {
  const breakdown = Array.isArray(client?.paidServiceVisitBreakdown) ? client.paidServiceVisitBreakdown : null;
  if (breakdown && breakdown.length > 0) {
    return breakdown.reduce((acc: number, b: any) => acc + (Number(b?.sumUAH) || 0), 0);
  }
  const cost = Number(client?.paidServiceTotalCost);
  return Number.isFinite(cost) ? cost : 0;
}

/**
 * Обчислює KPI по періодах (past, today, future) зі списку клієнтів.
 * Клієнти мають бути вже обогачені (consultationRecordCreatedAt, paidServiceRecordCreatedAt, paidServiceIsRebooking, paidRecordsInHistoryCount).
 * kvTodayCounts — джерело правди для consultationCreated, recordsCreatedSum, rebookingsCount за сьогодні (з KV).
 */
export function computePeriodStats(
  clients: any[],
  opts: ComputePeriodStatsOptions
): { past: StatsBlock; today: TodayStats; future: StatsBlock; newLeadsIdsToday: Set<string>; newLeadsIdsPast: Set<string> } {
  const { todayKyiv, start, end, nextMonthBounds, plus2MonthsBounds, kvTodayCounts } = opts;

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
  const newLeadsIdsToday = new Set<string>();
  const newLeadsIdsPast = new Set<string>();
  let newPaidClientsTodayCount = 0;
  const returnedClientIdsPast = new Set<string>();
  const returnedClientIdsToday = new Set<string>();
  const returnedClientIdsFuture = new Set<string>();

  // Нові ліди: firstContactDate або createdAt сьогодні. Виключаємо placeholder usernames.
  for (const c of clients) {
    if (isPlaceholderUsername((c as any).instagramUsername)) continue;
    const firstContactDay = toKyivDay((c as any).firstContactDate || (c as any).createdAt);
    if (firstContactDay) {
      if (firstContactDay === todayKyiv) newLeadsIdsToday.add(c.id);
      if (firstContactDay >= start && firstContactDay <= todayKyiv) newLeadsIdsPast.add(c.id);
    }
  }

  const addByDay = (day: string, apply: (block: StatsBlock) => void) => {
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

    const consultCreatedDay = toKyivDay((client as any).consultationRecordCreatedAt);
    if (consultCreatedDay && (client as any).isOnlineConsultation === true) {
      if (consultCreatedDay >= start && consultCreatedDay <= todayKyiv) {
        stats.past.consultationOnlineCount = (stats.past.consultationOnlineCount || 0) + 1;
      }
      if (consultCreatedDay === todayKyiv) t.consultationOnlineCount += 1;
    }

    const consultDay = toKyivDay(client.consultationBookingDate);
    if (consultDay) {
      addByDay(consultDay, (b) => {
        if (client.consultationAttended === true) b.successfulConsultations += 1;
        else if (client.consultationCancelled || client.consultationAttended === false) b.cancelledOrNoShow += 1;
      });
      if (consultDay >= start && consultDay <= todayKyiv) {
        if (client.consultationCancelled) stats.past.consultationCancelled = (stats.past.consultationCancelled || 0) + 1;
        else if (client.consultationAttended === true) stats.past.consultationRealized = (stats.past.consultationRealized || 0) + 1;
        else if (client.consultationAttended === false) stats.past.consultationNoShow = (stats.past.consultationNoShow || 0) + 1;
        else stats.past.consultationPlanned = (stats.past.consultationPlanned || 0) + 1;
      }
      if (consultDay === todayKyiv) {
        if (client.consultationCancelled) t.consultationCancelled += 1;
        else if (client.consultationAttended === true) t.consultationRealized += 1;
        else if (client.consultationAttended === false) t.consultationNoShow += 1;
        else t.consultationPlanned += 1;
      }
      if (consultDay > todayKyiv && consultDay <= end) {
        stats.future.consultationPlannedFuture = (stats.future.consultationPlannedFuture || 0) + 1;
        if ((client as any).isOnlineConsultation === true) {
          stats.future.consultationPlannedOnlineCount = (stats.future.consultationPlannedOnlineCount || 0) + 1;
        }
      }
      if (consultDay >= start && consultDay < todayKyiv) {
        stats.past.consultationBookedPast = (stats.past.consultationBookedPast || 0) + 1;
        if ((client as any).isOnlineConsultation === true) {
          stats.past.consultationBookedPastOnlineCount = (stats.past.consultationBookedPastOnlineCount || 0) + 1;
        }
      }
      if (consultDay === todayKyiv) {
        (stats.today as TodayStats).consultationBookedToday = ((stats.today as TodayStats).consultationBookedToday || 0) + 1;
        if ((client as any).isOnlineConsultation === true) {
          (stats.today as TodayStats).consultationBookedTodayOnlineCount = ((stats.today as TodayStats).consultationBookedTodayOnlineCount || 0) + 1;
        }
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

    if (paidCreatedDay === todayKyiv && (client as any).paidServiceIsRebooking === true) t.rebookingsCount += 1;
    if (paidCreatedDay && paidCreatedDay >= start && paidCreatedDay <= todayKyiv && (client as any).paidServiceIsRebooking === true) {
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
    const isNoSale = client.consultationAttended === true && (!client.paidServiceDate || !client.signedUpForPaidService);
    if (consultDay === todayKyiv && isNoSale) t.noSaleCount += 1;
    if (consultDay && consultDay >= start && consultDay <= todayKyiv && isNoSale) {
      stats.past.noSaleCount = (stats.past.noSaleCount || 0) + 1;
    }

    if (isRelevantToday && client.state === 'consultation-no-show') t.noRebookCount += 1;
    if (isRelevantPast && client.state === 'consultation-no-show') {
      stats.past.noRebookCount = (stats.past.noRebookCount || 0) + 1;
    }

    if (paidDay && paidDay < todayKyiv && (client as any).paidServiceIsRebooking !== true) {
      t.paidPastNoRebookCount = (t.paidPastNoRebookCount || 0) + 1;
    }

    if (paidCreatedDay === todayKyiv && paidSum > 0 && (client as any).paidServiceIsRebooking !== true && visitsCount >= 2) {
      t.recordsRestoredCount = (t.recordsRestoredCount || 0) + 1;
    }

    const paidRecordsInHistory = (client as any).paidRecordsInHistoryCount;
    if (paidCreatedDay === todayKyiv && paidSum > 0 && paidRecordsInHistory === 0) {
      newPaidClientsTodayCount += 1;
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

    // Нові клієнти: перший платний запис + attendant=1
    const paidRecordsInHistory = (client as any).paidRecordsInHistoryCount;
    const isFirstPaidRecord = paidRecordsInHistory !== undefined && paidRecordsInHistory === 0;
    if (isFirstPaidRecord && client.paidServiceAttended === true && paidDay) {
      if (paidDay === todayKyiv) newClientsIdsToday.add(client.id);
      if (paidDay >= start && paidDay <= todayKyiv) newClientsIdsPast.add(client.id);
    }

    if (visitsCount >= 2) {
      if (consultDay && consultDay >= start && consultDay <= todayKyiv) returnedClientIdsPast.add(client.id);
      if (paidDay && paidDay >= start && paidDay <= todayKyiv) returnedClientIdsPast.add(client.id);
      if (consultDay === todayKyiv || paidDay === todayKyiv) returnedClientIdsToday.add(client.id);
      if (consultDay && consultDay > todayKyiv && consultDay <= end) returnedClientIdsFuture.add(client.id);
      if (paidDay && paidDay > todayKyiv && paidDay <= end) returnedClientIdsFuture.add(client.id);
    }
  }

  // Підрахунок «Створено консультацій» з БД (consultationRecordCreatedAt)
  let consultationCreatedPast = 0;
  let consultationCreatedToday = 0;
  for (const c of clients) {
    const createdAt = (c as any).consultationRecordCreatedAt;
    const day = toKyivDay(createdAt);
    if (!day) continue;
    addByDay(day, (b) => {
      b.createdConsultations += 1;
    });
    if (day >= start && day <= todayKyiv) consultationCreatedPast += 1;
    if (day === todayKyiv) consultationCreatedToday += 1;
  }
  let fallbackConsultCreatedToday = 0;
  for (const c of clients) {
    if (!c.altegioClientId) continue;
    const bookDay = toKyivDay(c.consultationBookingDate);
    if (bookDay !== todayKyiv) continue;
    const hasCreatedAt = Boolean((c as any).consultationRecordCreatedAt);
    if (!hasCreatedAt) fallbackConsultCreatedToday += 1;
  }
  consultationCreatedToday = Math.max(consultationCreatedToday, fallbackConsultCreatedToday);
  consultationCreatedToday = Math.max(consultationCreatedToday, kvTodayCounts.consultationCreated);
  stats.past.consultationCreated = consultationCreatedPast;
  (stats.today as TodayStats).consultationCreated = consultationCreatedToday;

  // recordsCreatedSum за сьогодні: KV — пріоритет над client-based
  (stats.today as TodayStats).recordsCreatedSum = Math.max(
    (stats.today as TodayStats).recordsCreatedSum ?? 0,
    kvTodayCounts.recordsCreatedSum
  );
  const clientBasedRebookingsCount = (stats.today as TodayStats).rebookingsCount ?? 0;
  (stats.today as TodayStats).rebookingsCount = Math.max(
    clientBasedRebookingsCount,
    kvTodayCounts.rebookingsCount ?? 0
  );

  (stats.today as TodayStats).newClientsCount = newClientsIdsToday.size;
  stats.past.newClientsCount = newClientsIdsPast.size;
  (stats.today as TodayStats).newLeadsCount = newLeadsIdsToday.size;
  stats.past.newLeadsCount = newLeadsIdsPast.size;
  stats.past.returnedClientsCount = returnedClientIdsPast.size;
  (stats.today as TodayStats).returnedClientsCount = null;
  stats.future.returnedClientsCount = returnedClientIdsFuture.size;
  (stats.today as TodayStats).newPaidClients = newPaidClientsTodayCount;
  stats.past.newPaidClients = stats.past.sales;

  stats.past.conversion1Rate = consultBookedPast > 0 ? (consultAttendedPast / consultBookedPast) * 100 : 0;
  stats.past.conversion2Rate = consultAttendedPast > 0 ? (salesFromConsultPast / consultAttendedPast) * 100 : 0;

  return { past: stats.past, today: stats.today, future: stats.future, newLeadsIdsToday, newLeadsIdsPast };
}
