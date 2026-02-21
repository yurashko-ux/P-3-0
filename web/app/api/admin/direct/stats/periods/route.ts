// web/app/api/admin/direct/stats/periods/route.ts
// Канонічний API для KPI по періодах (розділ Статистика). Джерело даних: тільки БД (вебхук/синхронізація).
// Підрахунок — через direct-stats-engine (єдине місце для статистики).

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { getTodayKyiv, toKyivDay } from '@/lib/direct-stats-config';
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
    const clients = await getAllDirectClients();

    const dayParam = req.nextUrl.searchParams.get('day') || '';
    const debugMode = req.nextUrl.searchParams.get('debug') === '1';
    const todayKyiv = getTodayKyiv(dayParam);
    const { start, end } = getMonthBounds(todayKyiv);
    const nextMonthBounds = getNextMonthBounds(todayKyiv);
    const plus2MonthsBounds = getPlus2MonthsBounds(todayKyiv);

    // Джерело даних: тільки БД. Всі дані (consultationBookingDate, paidServiceDate, attendance тощо) — з вебхука/синхронізації.
    const kvTodayCounts = {
      consultationCreated: 0,
      recordsCreatedSum: 0,
      rebookingsCount: 0,
      rebookingsDebug: [] as Array<{ altegioClientId: number; futurePaidDays: string[] }>,
    };

    const { past, today, future, newLeadsIdsToday } = computePeriodStats(clients, {
      todayKyiv,
      start,
      end,
      nextMonthBounds,
      plus2MonthsBounds,
      kvTodayCounts,
    });

    // Нові ліди: дата створення (createdAt) — сьогодні. Виключаємо placeholder usernames.
    let newLeadsCountToday = 0;
    try {
      const res = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count
        FROM direct_clients
        WHERE ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyiv}::date
        AND "instagramUsername" NOT LIKE 'missing_instagram_%'
        AND "instagramUsername" NOT LIKE 'no_instagram_%'
        AND "instagramUsername" <> ''
        AND "altegioClientId" IS NULL
      `;
      newLeadsCountToday = Number(res[0]?.count ?? 0);
    } catch (err) {
      console.warn('[direct/stats/periods] Помилка запиту newLeadsCount:', err);
    }
    today.newLeadsCount = newLeadsCountToday;

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

      // План/Факт діагностика: консультації та записи з датою сьогодні
      const consultTodayCount = clients.filter((c) => toKyivDay(c.consultationBookingDate) === todayKyiv).length;
      const consultRealizedTodayCount = clients.filter(
        (c) => toKyivDay(c.consultationBookingDate) === todayKyiv && c.consultationAttended === true
      ).length;
      const getPaidSumForDebug = (c: any) => {
        const bd = Array.isArray(c?.paidServiceVisitBreakdown) ? c.paidServiceVisitBreakdown : null;
        if (bd?.length) return bd.reduce((acc: number, b: any) => acc + (Number(b?.sumUAH) || 0), 0);
        return Number(c?.paidServiceTotalCost) || 0;
      };
      const paidTodayClients = clients.filter((c) => {
        const day = toKyivDay(c.paidServiceDate);
        const sum = getPaidSumForDebug(c);
        return day === todayKyiv && sum > 0;
      });
      const paidRealizedTodayCount = paidTodayClients.filter((c) => c.paidServiceAttended === true).length;
      const paidPlanSum = paidTodayClients.reduce((acc, c) => acc + getPaidSumForDebug(c), 0);
      const paidFactSum = paidTodayClients
        .filter((c) => c.paidServiceAttended === true)
        .reduce((acc, c) => acc + getPaidSumForDebug(c), 0);
      const planFactSamples = {
        consultationBookedToday: clients.filter((c) => toKyivDay(c.consultationBookingDate) === todayKyiv).slice(0, 5).map((c) => ({
          id: c.id,
          instagram: (c as any).instagramUsername,
          consultDate: c.consultationBookingDate,
          consultDay: toKyivDay(c.consultationBookingDate),
          attended: c.consultationAttended,
        })),
        paidToday: paidTodayClients.slice(0, 5).map((c) => ({
          id: c.id,
          instagram: (c as any).instagramUsername,
          paidDate: c.paidServiceDate,
          paidDay: toKyivDay(c.paidServiceDate),
          sum: getPaidSumForDebug(c),
          attended: c.paidServiceAttended,
        })),
        // Повний список клієнтів у підрахунку «Запис План/факт» — для перевірки
        paidTodayAll: paidTodayClients.map((c) => ({
          id: c.id,
          instagram: (c as any).instagramUsername,
          paidDate: c.paidServiceDate,
          sum: getPaidSumForDebug(c),
          attended: c.paidServiceAttended,
          cancelled: (c as any).paidServiceCancelled,
        })),
      };

      body._debug = {
        todayKyiv,
        dayParam: dayParam || '(не передано)',
        newLeadsCount: newLeadsCountToday,
        newLeadsFromEngine: newLeadsIdsToday.size,
        newLeadsSamples: debugNewLeadsSamples,
        recentClientsLast2Days: debugRecentSamples,
        rebookingsCount: today.rebookingsCount,
        rebookingsKvBased: kvTodayCounts.rebookingsCount,
        rebookingsByClient: kvTodayCounts.rebookingsDebug,
        planFact: {
          consultationBookedToday: today.consultationBookedToday ?? 0,
          consultationRealized: today.consultationRealized ?? 0,
          consultTodayCount,
          consultRealizedTodayCount,
          recordsPlannedCountToday: today.recordsPlannedCountToday ?? 0,
          recordsPlannedSumToday: today.recordsPlannedSumToday ?? 0,
          recordsRealizedCountToday: today.recordsRealizedCountToday ?? 0,
          recordsRealizedSum: today.recordsRealizedSum ?? 0,
          paidTodayCount: paidTodayClients.length,
          paidRealizedTodayCount,
          paidPlanSum,
          paidFactSum,
          samples: planFactSamples,
        },
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
