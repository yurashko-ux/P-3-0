// web/app/api/admin/direct/stats/active-base/route.ts
// Дані для графіків активної бази Direct зі snapshot-таблиці.

import { NextRequest, NextResponse } from 'next/server';
import {
  calculateDirectActiveBaseSnapshot,
  captureDirectActiveBaseSnapshot,
  getCurrentKyivDayForActiveBaseSnapshot,
  getDirectActiveBaseChartPayload,
} from '@/lib/direct-active-base-snapshot';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

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

function parseYear(raw: string | null): number {
  const n = Number((raw || '').trim());
  const currentYear = Number(getCurrentKyivDayForActiveBaseSnapshot().slice(0, 4));
  if (!Number.isInteger(n) || n < 2024 || n > currentYear + 1) return currentYear;
  return n;
}

function isMissingSnapshotTableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === 'P2021' ||
    (message.includes('direct_active_base_snapshots') &&
      (message.includes('does not exist') || message.includes('not exist')))
  );
}

function buildPayloadSummary(payload: Awaited<ReturnType<typeof getDirectActiveBaseChartPayload>>) {
  const dailyCount = payload.daily.length;
  const monthlyCount = payload.monthly.length;
  return {
    dailyCount,
    firstDay: payload.daily[0]?.kyivDay ?? null,
    lastDay: payload.daily[dailyCount - 1]?.kyivDay ?? null,
    monthlyCount,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const year = parseYear(req.nextUrl.searchParams.get('year'));

  try {
    let payload = await getDirectActiveBaseChartPayload(year);
    const todaySnapshot = await calculateDirectActiveBaseSnapshot();
    captureDirectActiveBaseSnapshot(todaySnapshot.kyivDay).catch((err) => {
      console.warn('[direct/stats/active-base] Не вдалося зберегти сьогоднішній snapshot (графік не блокуємо):', err);
    });
    if (
      todaySnapshot.kyivDay.startsWith(`${year}-`) &&
      !payload.daily.some((point) => point.kyivDay === todaySnapshot.kyivDay)
    ) {
      const previous = payload.daily[payload.daily.length - 1] ?? null;
      const previousSnapshot = previous
        ? await calculateDirectActiveBaseSnapshot(previous.kyivDay)
        : null;
      const currentIds = new Set(todaySnapshot.activeClientIds);
      const previousIds = new Set(previousSnapshot?.activeClientIds ?? []);
      const addedClientIds = previousSnapshot
        ? todaySnapshot.activeClientIds.filter((id) => !previousIds.has(id))
        : [];
      const removedClientIds = previousSnapshot
        ? previousSnapshot.activeClientIds.filter((id) => !currentIds.has(id))
        : [];
      const todayPoint = {
        kyivDay: todaySnapshot.kyivDay,
        activeBaseCount: todaySnapshot.activeBaseCount,
        inactiveBaseCount: todaySnapshot.inactiveBaseCount,
        totalClientsCount: todaySnapshot.totalClientsCount,
        deltaCount: previous ? todaySnapshot.activeBaseCount - previous.activeBaseCount : 0,
        addedClientIds,
        removedClientIds,
      };
      const daily = [...payload.daily, todayPoint].sort((a, b) => a.kyivDay.localeCompare(b.kyivDay));
      const latestByMonth = new Map<string, (typeof payload.monthly)[number]>();
      for (const point of daily) {
        const month = point.kyivDay.slice(0, 7);
        latestByMonth.set(month, { ...point, month });
      }
      payload = {
        daily,
        monthly: Array.from(latestByMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      };
    }
    const summary = buildPayloadSummary(payload);
    return NextResponse.json(
      {
        ok: true,
        year,
        todaySnapshot,
        summary,
        ...payload,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    if (isMissingSnapshotTableError(err)) {
      console.warn(
        '[direct/stats/active-base] Таблиця snapshot ще відсутня, повертаємо тимчасовий розрахунок:',
        err
      );
      const todaySnapshot = await calculateDirectActiveBaseSnapshot();
      const isRequestedYear = todaySnapshot.kyivDay.startsWith(`${year}-`);
      return NextResponse.json({
        ok: true,
        year,
        storageReady: false,
        warning:
          'Таблиця snapshot ще не застосована в БД. Після наступного deploy/migrate графік почне накопичувати історію.',
        todaySnapshot,
        daily: isRequestedYear ? [todaySnapshot] : [],
        monthly: isRequestedYear ? [{ ...todaySnapshot, month: todaySnapshot.kyivDay.slice(0, 7) }] : [],
      });
    }

    console.error('[direct/stats/active-base] GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
