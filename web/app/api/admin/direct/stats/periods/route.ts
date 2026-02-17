// web/app/api/admin/direct/stats/periods/route.ts
// Канонічний API для KPI по періодах (розділ Статистика). Джерело даних: наша БД + KV.
// Футер Direct споживає цей же API (джерело даних для футера — розділ Статистика).

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  pickRecordCreatedAtISOFromGroup,
  pickClosestConsultGroup,
  pickClosestPaidGroup,
  computeGroupTotalCostUAHUniqueMasters,
} from '@/lib/altegio/records-grouping';
import type { RecordGroup } from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

type FooterStatsBlock = {
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

type FooterTodayStats = FooterStatsBlock & {
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
  returnedClientsCount: number | null; // null = показувати «-» (критеріїв поки немає)
  recordsCancelledCount: number;
  recordsNoShowCount: number;
  recordsRestoredCount: number;
  paidPastNoRebookCount: number;
  turnoverToday: number;
};

const emptyBlock = (): FooterStatsBlock => ({
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

function emptyTodayBlock(): FooterTodayStats {
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

const addMonths = (monthKey: string, deltaMonths: number): string => {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1 + deltaMonths, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let clients = await getAllDirectClients();

    const dayParam = (req.nextUrl.searchParams.get('day') || '').trim().replace(/\//g, '-');
    const debugMode = req.nextUrl.searchParams.get('debug') === '1';
    const todayKyiv = /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam
      : kyivDayFromISO(new Date().toISOString());
    const { start, end } = getMonthBounds(todayKyiv);

    // Нові ліди: рахуємо ДО обогачення (як debug-new-leads). Виключаємо missing_instagram_* / no_instagram_* — системні записи.
    const newLeadsIdsToday = new Set<string>();
    const newLeadsIdsPast = new Set<string>();
    const isPlaceholderUsername = (u?: string | null) =>
      !u || u.startsWith('missing_instagram_') || u.startsWith('no_instagram_');
    for (const c of clients) {
      if (isPlaceholderUsername((c as any).instagramUsername)) continue;
      const firstContactDay = toKyivDay((c as any).firstContactDate || (c as any).createdAt);
      if (firstContactDay) {
        if (firstContactDay === todayKyiv) newLeadsIdsToday.add(c.id);
        if (firstContactDay >= start && firstContactDay <= todayKyiv) newLeadsIdsPast.add(c.id);
      }
    }

    // Обогачення з KV: дата створення запису консультації та платного запису (узгодження з фільтром "Консультації створені").
    let groupsByClient: Map<number, RecordGroup[]> = new Map();
    const kvTodayCounts = { consultationCreated: 0, recordsCreatedSum: 0, rebookingsCount: 0 };
    try {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 9999);
      const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
      groupsByClient = groupRecordsByClientDay(normalizedEvents);

      clients = clients.map((c) => {
        const enriched = { ...c } as typeof c & {
          consultationRecordCreatedAt?: string | null;
          paidServiceRecordCreatedAt?: string | null;
          paidRecordsInHistoryCount?: number;
        };
        if (c.altegioClientId) {
          const groups = groupsByClient.get(Number(c.altegioClientId)) ?? [];
          const consultDay = c.consultationBookingDate ? kyivDayFromISO(String(c.consultationBookingDate)) : null;
          const cg = pickClosestConsultGroup(groups, c.consultationBookingDate ?? undefined);
          // Attendance — тільки коли група для ТОГО Ж дня (cg.kyivDay === consultDay), щоб не застосовувати no-show від іншого дня.
          const consultGroup = cg && cg.kyivDay === consultDay ? cg : null;

          // Пріоритет: БД (consultationRecordCreatedAt) > KV (fallback для старих даних)
          const kvConsultCreatedAt = pickRecordCreatedAtISOFromGroup(cg);
          enriched.consultationRecordCreatedAt = (c as any).consultationRecordCreatedAt || kvConsultCreatedAt || undefined;

          // Обогащення attendance з KV.
          if (consultGroup) {
            const attStatus = String((consultGroup as any).attendanceStatus || '');
            if (attStatus === 'arrived' || (consultGroup as any).attendance === 1 || (consultGroup as any).attendance === 2) {
              enriched.consultationAttended = true;
              enriched.consultationCancelled = false;
            } else if (attStatus === 'no-show' || (consultGroup as any).attendance === -1) {
              if ((c as any).consultationAttended !== true) {
                enriched.consultationAttended = false;
                enriched.consultationCancelled = false;
              }
            } else if (attStatus === 'cancelled' || (consultGroup as any).attendance === -2) {
              if ((c as any).consultationAttended !== true) {
                enriched.consultationAttended = null;
                enriched.consultationCancelled = true;
              }
            }
          }

          if (c.paidServiceDate) {
            const paidGroup = pickClosestPaidGroup(groups, c.paidServiceDate);
            const kvPaidCreatedAt = pickRecordCreatedAtISOFromGroup(paidGroup);
            enriched.paidServiceRecordCreatedAt = (c as any).paidServiceRecordCreatedAt || kvPaidCreatedAt || undefined;
            // Кількість платних записів в історії ДО поточного (0 = перший платний запис, вогник)
            const paidGroups = groups.filter((g: any) => g?.groupType === 'paid');
            const currentCreatedAt = enriched.paidServiceRecordCreatedAt;
            if (currentCreatedAt) {
              const currTs = new Date(currentCreatedAt).getTime();
              enriched.paidRecordsInHistoryCount = paidGroups.filter((g: any) => {
                const gt = (g.receivedAt || (g as any).datetime || '').toString();
                const ts = new Date(gt).getTime();
                return isFinite(ts) && ts < currTs;
              }).length;
            }
            // paidServiceIsRebooking: перезапис = дата створення поточного запису = день attended-групи
            // Шукаємо attended: платна група або консультація (консультація сьогодні + платний запис сьогодні)
            const createdKyivDay = currentCreatedAt ? kyivDayFromISO(currentCreatedAt) : '';
            const attendedPaidGroup = createdKyivDay
              ? paidGroups.find(
                  (g: any) =>
                    (g?.kyivDay || '') === createdKyivDay &&
                    (g?.attendance === 1 || g?.attendance === 2 || (g as any).attendanceStatus === 'arrived')
                )
              : null;
            const consultGroups = groups.filter((g: any) => g?.groupType === 'consultation');
            const attendedConsultGroup = createdKyivDay
              ? consultGroups.find(
                  (g: any) =>
                    (g?.kyivDay || '') === createdKyivDay &&
                    (g?.attendance === 1 || g?.attendance === 2 || (g as any).attendanceStatus === 'arrived')
                )
              : null;
            if (attendedPaidGroup || attendedConsultGroup) (enriched as any).paidServiceIsRebooking = true;
          }
        }
        return enriched;
      });

      // Підрахунок «Створено сьогодні» напряму з KV — джерело правди для подій, створених сьогодні
      for (const [, groups] of groupsByClient) {
        for (const group of groups) {
          const createdAt = pickRecordCreatedAtISOFromGroup(group);
          const createdDay = toKyivDay(createdAt);
          if (createdDay !== todayKyiv) continue;

          if (group.groupType === 'consultation') {
            kvTodayCounts.consultationCreated += 1;
          }
        }
      }
      // recordsCreatedSum за сьогодні з KV (2 майстри = 2× вартість, без дублікатів)
      for (const client of clients) {
        if (!client.paidServiceDate || !client.altegioClientId) continue;
        const groups = groupsByClient.get(Number(client.altegioClientId)) ?? [];
        const paidGroup = pickClosestPaidGroup(groups, client.paidServiceDate);
        if (!paidGroup) continue;
        const paidRecordCreatedAt = pickRecordCreatedAtISOFromGroup(paidGroup);
        if (!paidRecordCreatedAt) continue;
        const createdDay = kyivDayFromISO(paidRecordCreatedAt);
        if (createdDay !== todayKyiv) continue;
        kvTodayCounts.recordsCreatedSum += computeGroupTotalCostUAHUniqueMasters(paidGroup);
      }
      // rebookingsCount напряму з KV: attended (paid або consultation) сьогодні + майбутній paid створений сьогодні
      let kvRebookingsToday = 0;
      for (const [, groups] of groupsByClient) {
        const paidGroups = groups.filter((g: any) => g?.groupType === 'paid');
        const consultGroups = groups.filter((g: any) => g?.groupType === 'consultation');
        const isAttended = (g: any) =>
          g?.attendance === 1 || g?.attendance === 2 || (g as any).attendanceStatus === 'arrived';
        const attendedToday = [...paidGroups, ...consultGroups].filter(
          (g: any) => (g?.kyivDay || '') === todayKyiv && isAttended(g)
        );
        if (attendedToday.length === 0) continue;
        const futurePaidCreatedToday = paidGroups.filter(
          (g: any) =>
            (g?.kyivDay || '') > todayKyiv &&
            kyivDayFromISO(pickRecordCreatedAtISOFromGroup(g) || '') === todayKyiv
        );
        if (futurePaidCreatedToday.length > 0) kvRebookingsToday += 1;
      }
      kvTodayCounts.rebookingsCount = kvRebookingsToday;
    } catch (err) {
      console.warn('[direct/stats/periods] KV обогащення пропущено (не критично):', err);
    }

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
    const debugNewLeadsSamples: Array<{ id: string; instagramUsername: string; firstContactDate: string; createdAt: string; firstContactDay: string }> = [];
    const debugRecentSamples: Array<{ id: string; instagramUsername: string; firstContactDate: string; createdAt: string; firstContactDay: string; match: boolean }> = [];
    let newPaidClientsTodayCount = 0;
    const returnedClientIdsPast = new Set<string>();
    const returnedClientIdsToday = new Set<string>();
    const returnedClientIdsFuture = new Set<string>();
    let totalSpentAll = 0;
    let clientsWithPaidInPast = 0;

    const addByDay = (day: string, apply: (block: FooterStatsBlock) => void) => {
      if (!day || day < start || day > end) return;
      if (day <= todayKyiv) {
        apply(stats.past);
        if (day === todayKyiv) apply(stats.today);
      } else {
        apply(stats.future);
      }
    };

    for (const client of clients) {
      const firstContactDate = (client as any).firstContactDate;
      const createdAt = (client as any).createdAt;
      const firstContactDay = toKyivDay(firstContactDate || createdAt);
      if (debugMode && firstContactDay === todayKyiv && debugNewLeadsSamples.length < 5) {
        debugNewLeadsSamples.push({
          id: client.id,
          instagramUsername: (client as any).instagramUsername || '',
          firstContactDate: String(firstContactDate || ''),
          createdAt: String(createdAt || ''),
          firstContactDay,
        });
      }
      if (debugMode && debugRecentSamples.length < 10) {
        const createdTs = createdAt ? new Date(createdAt).getTime() : 0;
        const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
        if (createdTs >= twoDaysAgo) {
          debugRecentSamples.push({
            id: client.id,
            instagramUsername: (client as any).instagramUsername || '',
            firstContactDate: String(firstContactDate || ''),
            createdAt: String(createdAt || ''),
            firstContactDay,
            match: firstContactDay === todayKyiv,
          });
        }
      }
      totalSpentAll += typeof client.spent === 'number' ? client.spent : 0;
      const visitsCount = typeof client.visits === 'number' ? client.visits : 0;
      const isEligibleSale = client.consultationAttended === true && !!client.paidServiceDate && visitsCount < 2;
      const paidSum = getPaidSum(client);
      const t = stats.today as FooterTodayStats;

      // 1) Створено консультацій — рахується безпосередньо з KV (див. блок після циклу), щоб врахувати всі записи, а не лише по клієнтах.
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

        // Заплановано (букінг-дати): past — з початку місяця до вчора, today — сьогодні
        if (consultDay >= start && consultDay < todayKyiv) {
          stats.past.consultationBookedPast = (stats.past.consultationBookedPast || 0) + 1;
          if ((client as any).isOnlineConsultation === true) {
            stats.past.consultationBookedPastOnlineCount = (stats.past.consultationBookedPastOnlineCount || 0) + 1;
          }
        }
        if (consultDay === todayKyiv) {
          (stats.today as FooterTodayStats).consultationBookedToday = ((stats.today as FooterTodayStats).consultationBookedToday || 0) + 1;
          if ((client as any).isOnlineConsultation === true) {
            (stats.today as FooterTodayStats).consultationBookedTodayOnlineCount = ((stats.today as FooterTodayStats).consultationBookedTodayOnlineCount || 0) + 1;
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
        if (paidDay >= start && paidDay <= todayKyiv) clientsWithPaidInPast += 1;
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

      // Перезаписи: рахуємо за датою створення запису (paidServiceRecordCreatedAt)
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
      // Без продажу (💔): консультація відбулась, але немає запису на платну послугу
      const isNoSale = client.consultationAttended === true && (!client.paidServiceDate || !client.signedUpForPaidService);
      if (consultDay === todayKyiv && isNoSale) t.noSaleCount += 1;
      if (consultDay && consultDay >= start && consultDay <= todayKyiv && isNoSale) {
        stats.past.noSaleCount = (stats.past.noSaleCount || 0) + 1;
      }

      if (isRelevantToday && client.state === 'consultation-no-show') t.noRebookCount += 1;
      if (isRelevantPast && client.state === 'consultation-no-show') {
        stats.past.noRebookCount = (stats.past.noRebookCount || 0) + 1;
      }

      // Букінгдата в минулому: paidServiceDate < сьогодні, запис не є перезаписом (не перезаписали)
      if (paidDay && paidDay < todayKyiv && (client as any).paidServiceIsRebooking !== true) {
        t.paidPastNoRebookCount = (t.paidPastNoRebookCount || 0) + 1;
      }

      // Відновлено записів: платний запис створений сьогодні, клієнт мав попередній платний запис зі скасуванням або no-show.
      // Спрощена логіка: запис створений сьогодні, не перезапис з attended, клієнт мав попередні візити (могла бути невдача).
      if (paidCreatedDay === todayKyiv && paidSum > 0 && (client as any).paidServiceIsRebooking !== true && visitsCount >= 2) {
        t.recordsRestoredCount = (t.recordsRestoredCount || 0) + 1;
      }

      // Новий клієнт (вогник): платний запис створений сьогодні, перший платний запис (paidRecordsInHistoryCount === 0)
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

    // Підрахунок "Створено" з БД (consultationRecordCreatedAt). Fallback: KV через обогачення вище.
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
    // Fallback: клієнти з consultationBookingDate = сьогодні, але без consultationRecordCreatedAt
    // (вебхук ще не прийшов або клієнт зі старих даних) — додаємо до "Створено сьогодні", щоб не занижувати.
    let fallbackConsultCreatedToday = 0;
    for (const c of clients) {
      if (!c.altegioClientId) continue; // тільки клієнти з Altegio (не ліди)
      const bookDay = toKyivDay(c.consultationBookingDate);
      if (bookDay !== todayKyiv) continue;
      const hasCreatedAt = Boolean((c as any).consultationRecordCreatedAt);
      if (!hasCreatedAt) fallbackConsultCreatedToday += 1;
    }
    consultationCreatedToday = Math.max(consultationCreatedToday, fallbackConsultCreatedToday);
    // Пріоритет KV: події створені сьогодні рахуємо напряму з KV (джерело правди)
    consultationCreatedToday = Math.max(consultationCreatedToday, kvTodayCounts.consultationCreated);
    stats.past.consultationCreated = consultationCreatedPast;
    (stats.today as FooterTodayStats).consultationCreated = consultationCreatedToday;

    // recordsCreatedSum для сьогодні: KV (computeGroupTotalCostUAHUniqueMasters) — коректно для 2+ майстрів
    (stats.today as FooterTodayStats).recordsCreatedSum = Math.max(
      (stats.today as FooterTodayStats).recordsCreatedSum ?? 0,
      kvTodayCounts.recordsCreatedSum
    );
    // rebookingsCount для сьогодні: KV — attended сьогодні + майбутній paid створений сьогодні (пріоритет над client-based)
    (stats.today as FooterTodayStats).rebookingsCount = Math.max(
      (stats.today as FooterTodayStats).rebookingsCount ?? 0,
      kvTodayCounts.rebookingsCount ?? 0
    );
    // Fallback: внутрішній виклик today-records-total (може мати інший результат на проді)
    try {
      const base = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const secret = process.env.CRON_SECRET;
      if (secret && base.startsWith('http')) {
        const trRes = await fetch(`${base}/api/admin/direct/today-records-total?secret=${encodeURIComponent(secret)}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        const trData = await trRes.json();
        if (trData?.ok && typeof trData.total === 'number' && trData.total > 0) {
          (stats.today as FooterTodayStats).recordsCreatedSum = Math.max(
            (stats.today as FooterTodayStats).recordsCreatedSum ?? 0,
            trData.total
          );
        }
      }
    } catch (err) {
      console.warn('[direct/stats/periods] today-records-total fallback skip:', err);
    }

    // Відновлено консультацій: з direct_client_state_logs — записи з state = 'consultation-rescheduled', createdAt = сьогодні (Europe/Kyiv)
    let consultationRescheduledTodayCount = 0;
    try {
      const res = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::int as count FROM "direct_client_state_logs"
        WHERE state = 'consultation-rescheduled'
        AND ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyiv}::date
      `;
      consultationRescheduledTodayCount = Number(res[0]?.count ?? 0);
    } catch (err) {
      console.warn('[direct/stats/periods] Помилка запиту consultationRescheduledCount:', err);
    }
    (stats.today as FooterTodayStats).consultationRescheduledCount = consultationRescheduledTodayCount;

    (stats.today as FooterTodayStats).newClientsCount = newClientsIdsToday.size;
    stats.past.newClientsCount = newClientsIdsPast.size;
    (stats.today as FooterTodayStats).newLeadsCount = newLeadsIdsToday.size;
    stats.past.newLeadsCount = newLeadsIdsPast.size;
    stats.past.returnedClientsCount = returnedClientIdsPast.size;
    (stats.today as FooterTodayStats).returnedClientsCount = null; // Показувати «-» — критеріїв поки немає
    stats.future.returnedClientsCount = returnedClientIdsFuture.size;
    (stats.today as FooterTodayStats).newPaidClients = newPaidClientsTodayCount;
    stats.past.newPaidClients = stats.past.sales;

    stats.past.conversion1Rate = consultBookedPast > 0 ? (consultAttendedPast / consultBookedPast) * 100 : 0;
    stats.past.conversion2Rate = consultAttendedPast > 0 ? (salesFromConsultPast / consultAttendedPast) * 100 : 0;

    // #region agent log
    try {
      const payload = { location: 'stats/periods/route.ts:recordsRealizedSum-debug', message: 'recordsRealizedSum vs totalSpent', data: { recordsRealizedSum: stats.past.recordsRealizedSum, totalSpentAll, clientsWithPaidInPast, totalClients: clients.length }, timestamp: Date.now(), hypothesisId: 'H3' };
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
      const fs = await import('fs/promises');
      const path = await import('path');
      const logPath = path.join(process.cwd(), '.debug-agent.log');
      await fs.appendFile(logPath, JSON.stringify(payload) + '\n').catch(() => {});
    } catch (_) {}
    // #endregion

    // Єдине джерело для "кількість клієнтів" на екрані Статистика (той самий список, що й для KPI).
    const body: Record<string, unknown> = { ok: true, stats, totalClients: clients.length };
    if (debugMode) {
      body._debug = {
        todayKyiv,
        dayParam: dayParam || '(не передано)',
        newLeadsCount: newLeadsIdsToday.size,
        newLeadsSamples: debugNewLeadsSamples,
        recentClientsLast2Days: debugRecentSamples.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      };
    }
    return NextResponse.json(body);
  } catch (err) {
    console.error('[direct/stats/periods] GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
