// web/app/api/admin/direct/last-visit-updates/route.ts
// Оновлення lastVisitAt для UI без перезавантаження сторінки (опитування після вебхука).

import { NextRequest, NextResponse } from 'next/server';
import { getLastVisitAtUpdates } from '@/lib/direct-last-visit-updates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const since = (req.nextUrl.searchParams.get('since') || '').trim();
  const serverTime = new Date().toISOString();

  try {
    const updates = await getLastVisitAtUpdates(since || '1970-01-01T00:00:00.000Z');
    return NextResponse.json({
      ok: true,
      updates: updates.map((u) => ({
        clientId: u.clientId,
        lastVisitAt: u.lastVisitAt,
        daysSinceLastVisit: u.daysSinceLastVisit,
      })),
      serverTime,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
