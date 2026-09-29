// web/app/api/admin/direct/reconcile-paid-day-from-api/route.ts
// Звірка платних записів за день: Altegio GET /records vs Direct (без змін у БД).

import { NextRequest, NextResponse } from 'next/server';
import { reconcilePaidDayFromAltegioApi } from '@/lib/altegio/paid-day-api-reconcile';
import { getTodayKyiv, getPreviousKyivDay } from '@/lib/direct-stats-config';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

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

export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * GET/POST ?day=YYYY-MM-DD
 * Без day — вчора (Kyiv), як у щоденному звіті.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dayParam = req.nextUrl.searchParams.get('day');
    const kyivDay = dayParam ? getTodayKyiv(dayParam) : getPreviousKyivDay();

    console.log('[reconcile-paid-day-from-api] Запит звірки', { kyivDay, dayParam });

    const result = await reconcilePaidDayFromAltegioApi({ kyivDay });

    const gaps = result.rows.filter((r) => r.kind !== 'ok');

    return NextResponse.json({
      ok: true,
      message: `Звірка ${result.kyivDay}: Altegio клієнтів=${result.altegioPaidClients}, Direct з датою=${result.directWithPaidDate}, прогалин=${gaps.length}`,
      ...result,
      gaps,
    });
  } catch (err) {
    console.error('[reconcile-paid-day-from-api] Помилка:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
