// web/app/api/admin/direct/stats/periods/route.ts
// Канонічний API для KPI по періодах (розділ Статистика). Джерело даних: наша БД + KV.
// Підрахунок — через direct-stats-engine (єдине місце для статистики).

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
import { KV_LIMIT_RECORDS, KV_LIMIT_WEBHOOK, getTodayKyiv, toKyivDay } from '@/lib/direct-stats-config';
import { computePeriodStats } from '@/lib/direct-stats-engine';

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let clients = await getAllDirectClients();

    const dayParam = req.nextUrl.searchParams.get('day') || '';
    const debugMode = req.nextUrl.searchParams.get('debug') === '1';
    const todayKyiv = getTodayKyiv(dayParam);
    const { start, end } = getMonthBounds(todayKyiv);
    const nextMonthBounds = getNextMonthBounds(todayKyiv);
    const plus2MonthsBounds = getPlus2MonthsBounds(todayKyiv);

    // Обогачення з KV: дата створення запису консультації та платного запису, attendance, paidServiceIsRebooking.
    let groupsByClient: Map<number, RecordGroup[]> = new Map();
    const kvTodayCounts = {
      consultationCreated: 0,
      recordsCreatedSum: 0,
      rebookingsCount: 0,
      rebookingsDebug: [] as Array<{ altegioClientId: number; futurePaidDays: string[] }>,
    };

    try {
      const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, KV_LIMIT_RECORDS - 1);
      const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, KV_LIMIT_WEBHOOK - 1);
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
          const consultGroup = cg && cg.kyivDay === consultDay ? cg : null;

          const kvConsultCreatedAt = pickRecordCreatedAtISOFromGroup(cg);
          enriched.consultationRecordCreatedAt = (c as any).consultationRecordCreatedAt || kvConsultCreatedAt || undefined;

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
            const createdKyivDay = currentCreatedAt ? kyivDayFromISO(currentCreatedAt) : '';
            const attendedPaidGroup = createdKyivDay
              ? paidGroups.find((g: any) => {
                  if ((g?.kyivDay || '') !== createdKyivDay) return false;
                  if (!(g?.attendance === 1 || g?.attendance === 2 || (g as any).attendanceStatus === 'arrived')) return false;
                  const groupDatetime = (g as any)?.datetime;
                  if (!groupDatetime) return false;
                  const visitDay = kyivDayFromISO(groupDatetime);
                  return visitDay === createdKyivDay;
                })
              : null;
            if (attendedPaidGroup) (enriched as any).paidServiceIsRebooking = true;
          }
        }
        return enriched;
      });

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

      let kvRebookingsToday = 0;
      for (const [altegioClientId, groups] of groupsByClient) {
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
        if (futurePaidCreatedToday.length > 0) {
          kvRebookingsToday += 1;
          kvTodayCounts.rebookingsDebug.push({
            altegioClientId: Number(altegioClientId),
            futurePaidDays: futurePaidCreatedToday.map((g: any) => g?.kyivDay || '').filter(Boolean),
          });
        }
      }
      kvTodayCounts.rebookingsCount = kvRebookingsToday;
    } catch (err) {
      console.warn('[direct/stats/periods] KV обогащення пропущено (не критично):', err);
    }

    const { past, today, future, newLeadsIdsToday } = computePeriodStats(clients, {
      todayKyiv,
      start,
      end,
      nextMonthBounds,
      plus2MonthsBounds,
      kvTodayCounts,
    });

    // Відновлено консультацій: з direct_client_state_logs
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
    today.consultationRescheduledCount = consultationRescheduledTodayCount;

    const stats = { past, today, future };

    const body: Record<string, unknown> = { ok: true, stats, totalClients: clients.length };
    if (debugMode) {
      const debugNewLeadsSamples: Array<{ id: string; instagramUsername: string; firstContactDate: string; createdAt: string; firstContactDay: string }> = [];
      const debugRecentSamples: Array<{ id: string; instagramUsername: string; firstContactDate: string; createdAt: string; firstContactDay: string; match: boolean }> = [];
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      for (const client of clients) {
        const firstContactDate = (client as any).firstContactDate;
        const createdAt = (client as any).createdAt;
        const firstContactDay = toKyivDay(firstContactDate || createdAt);
        if (firstContactDay === todayKyiv && debugNewLeadsSamples.length < 5) {
          debugNewLeadsSamples.push({
            id: client.id,
            instagramUsername: (client as any).instagramUsername || '',
            firstContactDate: String(firstContactDate || ''),
            createdAt: String(createdAt || ''),
            firstContactDay,
          });
        }
        const createdTs = createdAt ? new Date(createdAt).getTime() : 0;
        if (createdTs >= twoDaysAgo && debugRecentSamples.length < 10) {
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
      debugRecentSamples.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      body._debug = {
        todayKyiv,
        dayParam: dayParam || '(не передано)',
        newLeadsCount: newLeadsIdsToday.size,
        newLeadsSamples: debugNewLeadsSamples,
        recentClientsLast2Days: debugRecentSamples,
        rebookingsCount: today.rebookingsCount,
        rebookingsKvBased: kvTodayCounts.rebookingsCount,
        rebookingsByClient: kvTodayCounts.rebookingsDebug,
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
