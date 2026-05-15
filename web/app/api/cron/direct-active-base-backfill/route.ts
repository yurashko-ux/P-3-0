// web/app/api/cron/direct-active-base-backfill/route.ts
// Ручний/cron backfill історії активної бази Direct зі збережених Altegio/KV даних.

import { NextRequest, NextResponse } from 'next/server';
import {
  backfillDirectActiveBaseSnapshotsFromExistingData,
  getCurrentKyivDayForActiveBaseSnapshot,
  getDirectActiveBaseChartPayload,
} from '@/lib/direct-active-base-snapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function okCron(req: NextRequest): boolean {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  const envSecret = process.env.CRON_SECRET || '';
  const urlSecret = req.nextUrl.searchParams.get('secret');
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  const authHeader = req.headers.get('authorization');
  if (envSecret && authHeader === `Bearer ${envSecret}`) return true;

  return false;
}

function parseYear(raw: string | null): number {
  const n = Number((raw || '').trim());
  const currentYear = Number(getCurrentKyivDayForActiveBaseSnapshot().slice(0, 4));
  if (!Number.isInteger(n) || n < 2024 || n > currentYear) return currentYear;
  return n;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  try {
    const year = parseYear(req.nextUrl.searchParams.get('year'));
    const result = await backfillDirectActiveBaseSnapshotsFromExistingData(year);
    const payload = await getDirectActiveBaseChartPayload(year);
    const dailyCount = payload.daily.length;
    const firstDay = payload.daily[0]?.kyivDay ?? null;
    const lastDay = payload.daily[dailyCount - 1]?.kyivDay ?? null;
    const monthlyCount = payload.monthly.length;
    console.log('[cron/direct-active-base-backfill] ✅ Backfill complete:', {
      year,
      ...result,
      dailyCount,
      firstDay,
      lastDay,
      monthlyCount,
    });
    return NextResponse.json(
      { ok: true, year, ...result, dailyCount, firstDay, lastDay, monthlyCount },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    console.error('[cron/direct-active-base-backfill] ❌ Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
