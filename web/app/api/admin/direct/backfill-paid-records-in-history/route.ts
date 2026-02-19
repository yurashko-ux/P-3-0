// web/app/api/admin/direct/backfill-paid-records-in-history/route.ts
// Одноразовий backfill paidRecordsInHistoryCount для існуючих клієнтів з paidServiceDate.
// Викликає Altegio API visits/search для кожного клієнта.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPaidRecordsInHistoryCount } from '@/lib/altegio/visits';
import { saveDirectClient } from '@/lib/direct-store';
import type { DirectClient } from '@/lib/direct-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = parseInt(process.env.ALTEGIO_COMPANY_ID || '0', 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({
      ok: false,
      error: 'ALTEGIO_COMPANY_ID не налаштовано або невалідний',
    }, { status: 400 });
  }

  const delayMs = Math.min(1000, Math.max(200, parseInt(req.nextUrl.searchParams.get('delayMs') || '300', 10) || 300));
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '0', 10) || 0;

  try {
    const clients = await prisma.directClient.findMany({
      where: {
        paidServiceDate: { not: null },
        altegioClientId: { not: null },
        paidRecordsInHistoryCount: null,
      },
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        paidServiceDate: true,
      },
      ...(limit > 0 ? { take: limit } : {}),
    });

    const stats = { total: clients.length, updated: 0, errors: 0, skipped: 0 };
    const details: Array<{ id: string; instagramUsername: string | null; count: number | null; status: string }> = [];

    for (const c of clients) {
      try {
        const paidServiceDate = c.paidServiceDate?.toISOString?.() ?? String(c.paidServiceDate);
        if (!paidServiceDate || !c.altegioClientId) {
          stats.skipped++;
          continue;
        }
        const count = await getPaidRecordsInHistoryCount(companyId, c.altegioClientId, paidServiceDate);
        await new Promise((r) => setTimeout(r, delayMs));

        const full = await prisma.directClient.findUnique({ where: { id: c.id } });
        if (!full) {
          stats.errors++;
          details.push({ id: c.id, instagramUsername: c.instagramUsername, count, status: 'not_found' });
          continue;
        }
        const updated = { ...full, paidRecordsInHistoryCount: count } as unknown as DirectClient;
        await saveDirectClient(updated, 'backfill-paid-records-in-history', { altegioClientId: c.altegioClientId }, { touchUpdatedAt: false });
        stats.updated++;
        details.push({ id: c.id, instagramUsername: c.instagramUsername, count, status: 'ok' });
      } catch (err) {
        stats.errors++;
        details.push({
          id: c.id,
          instagramUsername: c.instagramUsername,
          count: null,
          status: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Backfill завершено: оновлено ${stats.updated}, помилок ${stats.errors}, пропущено ${stats.skipped}`,
      stats,
      details: details.slice(0, 50),
    });
  } catch (err) {
    console.error('[backfill-paid-records-in-history] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
