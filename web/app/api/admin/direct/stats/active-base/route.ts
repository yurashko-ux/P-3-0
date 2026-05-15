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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const year = parseYear(req.nextUrl.searchParams.get('year'));

  try {
    const todaySnapshot = await captureDirectActiveBaseSnapshot();
    const payload = await getDirectActiveBaseChartPayload(year);
    return NextResponse.json({
      ok: true,
      year,
      todaySnapshot,
      ...payload,
    });
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
