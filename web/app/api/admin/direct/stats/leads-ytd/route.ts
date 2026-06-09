// Batch KPI для таблиці «Ліди» на сторінці Статистика — один getAllDirectClients замість N паралельних statsOnly.
import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { getTodayKyiv, getKyivDayUtcBounds, isValidDirectStatsMonthKey } from '@/lib/direct-stats-config';
import {
  applyVisitsConsultDisplayRule,
  computeDirectPeriodStatsForAnchor,
} from '@/lib/direct-stats-period-for-anchor';
import { getLeadsMonthAnchorDate, monthKeysFromYearStart } from '@/lib/direct-leads-masters-stats';
import {
  endOfMonthKyivFromDay,
  startOfMonthKyivFromDay,
} from '@/lib/direct-f4-client-match';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; payload: unknown }>();

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;

  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

async function countF4MonthToDate(anchorKyiv: string): Promise<number> {
  const startOfMonthKyiv = startOfMonthKyivFromDay(anchorKyiv);
  const endOfMonthKyiv = endOfMonthKyivFromDay(anchorKyiv);
  const { startUtc: monthStartUtc } = getKyivDayUtcBounds(startOfMonthKyiv);
  const { endUtc: monthEndExclusiveUtc } = getKyivDayUtcBounds(endOfMonthKyiv);

  return prisma.directClient.count({
    where: {
      paidServiceTotalCost: { gt: 0 },
      paidRecordsInHistoryCount: 0,
      paidServiceIsRebooking: { not: true },
      paidServiceRecordCreatedAt: {
        gte: monthStartUtc,
        lt: monthEndExclusiveUtc,
      },
    },
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const throughMonth = req.nextUrl.searchParams.get('throughMonth');
    if (!throughMonth || !isValidDirectStatsMonthKey(throughMonth)) {
      return NextResponse.json(
        { ok: false, error: 'throughMonth must be YYYY-MM from 2026-01' },
        { status: 400 }
      );
    }

    const cacheKey = `leads-ytd:${throughMonth}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: { 'X-Direct-Leads-Ytd-Cache': 'HIT' },
      });
    }

    const todayKyiv = getTodayKyiv();
    const monthKeys = monthKeysFromYearStart(throughMonth);
    const rawClients = await getAllDirectClients();
    const clients = applyVisitsConsultDisplayRule(rawClients);

    const rows = await Promise.all(
      monthKeys.map(async (monthKey) => {
        const anchor = getLeadsMonthAnchorDate(monthKey, todayKyiv);
        const [{ periodStats }, f4MonthToDate] = await Promise.all([
          computeDirectPeriodStatsForAnchor({
            clients,
            dayParam: anchor,
            statsFullPicture: true,
          }),
          countF4MonthToDate(anchor),
        ]);
        return {
          monthKey,
          periodStats,
          f4MonthToDate,
        };
      })
    );

    const payload = {
      ok: true,
      throughMonth,
      todayKyiv,
      months: rows,
    };
    cache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS });

    console.log('[direct/stats/leads-ytd] Завантажено місяців:', rows.length, 'клієнтів:', clients.length);
    return NextResponse.json(payload, {
      headers: { 'X-Direct-Leads-Ytd-Cache': 'MISS' },
    });
  } catch (err) {
    console.error('[direct/stats/leads-ytd] GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
