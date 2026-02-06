// web/app/api/admin/direct/cron-sync-direct-altegio-metrics-status/route.ts
// Показує останній запуск крону sync-direct-altegio-metrics (heartbeat з KV).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

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

  try {
    const raw = await kvRead.getRaw('direct:cron:sync-direct-altegio-metrics:lastRun');
    const parsed = raw ? JSON.parse(raw) : null;
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const hasAltegioCompanyId = !!companyIdStr.trim() && !Number.isNaN(parseInt(companyIdStr, 10));
    return NextResponse.json({
      ok: true,
      lastRun: parsed,
      env: {
        ALTEGIO_COMPANY_ID: hasAltegioCompanyId ? '✅ налаштовано' : '❌ не налаштовано (lastVisitAt не синхронізується!)',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

