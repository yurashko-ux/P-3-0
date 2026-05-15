// web/app/api/cron/direct-active-base-snapshot/route.ts
// Щоденно зберігає snapshot активної/неактивної клієнтської бази Direct.

import { NextRequest, NextResponse } from 'next/server';
import {
  captureDirectActiveBaseSnapshot,
  getCurrentKyivDayForActiveBaseSnapshot,
} from '@/lib/direct-active-base-snapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function okCron(req: NextRequest): boolean {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  const authHeader = req.headers.get('authorization');
  if (envSecret && authHeader === `Bearer ${envSecret}`) return true;

  return false;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  try {
    const dayParam = (req.nextUrl.searchParams.get('day') || '').trim();
    const kyivDay = /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam
      : getCurrentKyivDayForActiveBaseSnapshot();
    const snapshot = await captureDirectActiveBaseSnapshot(kyivDay);
    console.log('[cron/direct-active-base-snapshot] ✅ Snapshot saved:', snapshot);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    console.error('[cron/direct-active-base-snapshot] ❌ Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
