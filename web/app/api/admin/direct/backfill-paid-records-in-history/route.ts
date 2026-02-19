// web/app/api/admin/direct/backfill-paid-records-in-history/route.ts
// Одноразовий backfill paidRecordsInHistoryCount для існуючих клієнтів з paidServiceDate.
// Використовує GET /records (bulk) з пагінацією — ефективніше ніж виклик на кожного клієнта.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllRecordsForLocation, isConsultationService } from '@/lib/altegio/records';
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

function countPaidBefore(
  list: Array<{ ts: number; isPaid: boolean }>,
  beforeTs: number
): number {
  return list.filter((x) => x.isPaid && x.ts < beforeTs).length;
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

  const force = req.nextUrl.searchParams.get('force') === 'true';
  const delayMs = Math.min(1000, Math.max(100, parseInt(req.nextUrl.searchParams.get('delayMs') || '250', 10) || 250));
  const countPerPage = Math.min(100, Math.max(10, parseInt(req.nextUrl.searchParams.get('countPerPage') || '50', 10) || 50));

  try {
    const where: any = {
      paidServiceDate: { not: null },
      altegioClientId: { not: null },
    };
    if (!force) {
      where.paidRecordsInHistoryCount = null;
    }

    const clients = await prisma.directClient.findMany({
      where,
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        paidServiceDate: true,
      },
    });

    if (clients.length === 0) {
      return NextResponse.json({
        ok: true,
        message: force
          ? 'Немає клієнтів з paidServiceDate та altegioClientId'
          : 'Немає клієнтів з paidRecordsInHistoryCount=null. Використовуйте ?force=true для перезапису.',
        stats: { total: 0, updated: 0, errors: 0, skipped: 0 },
        details: [],
      });
    }

    const allRecords = await fetchAllRecordsForLocation(companyId, {
      delayMs,
      countPerPage,
    });

    const byClient = new Map<number, Array<{ ts: number; isPaid: boolean }>>();
    for (const r of allRecords) {
      const clientId = r.client_id;
      if (clientId == null || !Number.isFinite(Number(clientId))) continue;
      const dt = r.date ?? (r as any).create_date;
      if (!dt) continue;
      const ts = new Date(dt).getTime();
      if (!Number.isFinite(ts)) continue;
      const isPaid =
        !r.deleted &&
        Array.isArray(r.services) &&
        r.services.length > 0 &&
        !isConsultationService(r.services).isConsultation;
      const list = byClient.get(clientId) ?? [];
      list.push({ ts, isPaid });
      byClient.set(clientId, list);
    }

    const stats = { total: clients.length, updated: 0, errors: 0, skipped: 0 };
    const details: Array<{ id: string; instagramUsername: string | null; count: number | null; status: string }> = [];

    for (const c of clients) {
      try {
        const paidServiceDate = c.paidServiceDate?.toISOString?.() ?? String(c.paidServiceDate);
        if (!paidServiceDate || !c.altegioClientId) {
          stats.skipped++;
          continue;
        }
        const beforeTs = new Date(paidServiceDate).getTime();
        if (!Number.isFinite(beforeTs)) {
          stats.skipped++;
          continue;
        }
        const list = byClient.get(c.altegioClientId) ?? [];
        const count = countPaidBefore(list, beforeTs);

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
      stats: { ...stats, recordsFetched: allRecords.length },
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
