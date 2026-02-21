// web/app/api/admin/direct/backfill-paid-service-is-rebooking/route.ts
// Backfill paidServiceIsRebooking для існуючих клієнтів з paidServiceDate та paidServiceRecordCreatedAt.
// Використовує Altegio API GET /records для перевірки: дата створення = букінгдата попереднього attended.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPaidServiceIsRebooking } from '@/lib/altegio/visits';
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

  const force = req.nextUrl.searchParams.get('force') === 'true';
  const delayMs = Math.min(500, Math.max(50, parseInt(req.nextUrl.searchParams.get('delayMs') || '100', 10) || 100));

  try {
    const where: any = {
      paidServiceDate: { not: null },
      paidServiceRecordCreatedAt: { not: null },
      altegioClientId: { not: null },
    };
    if (!force) {
      where.paidServiceIsRebooking = null;
    }

    const clients = await prisma.directClient.findMany({
      where,
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        paidServiceDate: true,
        paidServiceRecordCreatedAt: true,
        paidServiceIsRebooking: true,
      },
    });

    if (clients.length === 0) {
      return NextResponse.json({
        ok: true,
        message: force
          ? 'Немає клієнтів з paidServiceDate, paidServiceRecordCreatedAt та altegioClientId'
          : 'Немає клієнтів з paidServiceIsRebooking=null. Використовуйте ?force=true для перезапису.',
        stats: { total: 0, updated: 0, errors: 0, skipped: 0 },
        details: [],
      });
    }

    const stats = { total: clients.length, updated: 0, errors: 0, skipped: 0 };
    const details: Array<{ id: string; instagramUsername: string | null; isRebook: boolean; status: string }> = [];

    for (const c of clients) {
      try {
        const paidServiceDate = c.paidServiceDate?.toISOString?.() ?? String(c.paidServiceDate);
        const paidServiceRecordCreatedAt = c.paidServiceRecordCreatedAt?.toISOString?.() ?? String(c.paidServiceRecordCreatedAt);
        if (!paidServiceDate || !c.altegioClientId || !paidServiceRecordCreatedAt) {
          stats.skipped++;
          continue;
        }

        const isRebook = await getPaidServiceIsRebooking(
          companyId,
          c.altegioClientId,
          paidServiceDate,
          paidServiceRecordCreatedAt
        );

        if (!force && (c.paidServiceIsRebooking === isRebook)) {
          stats.skipped++;
          continue;
        }

        const full = await prisma.directClient.findUnique({ where: { id: c.id } });
        if (!full) {
          stats.errors++;
          details.push({ id: c.id, instagramUsername: c.instagramUsername, isRebook, status: 'not_found' });
          continue;
        }

        const updated = { ...full, paidServiceIsRebooking: isRebook } as unknown as DirectClient;
        await saveDirectClient(updated, 'backfill-paid-service-is-rebooking', {
          altegioClientId: c.altegioClientId,
          isRebook,
        }, { touchUpdatedAt: false });
        stats.updated++;
        details.push({ id: c.id, instagramUsername: c.instagramUsername, isRebook, status: 'ok' });
      } catch (err) {
        stats.errors++;
        details.push({
          id: c.id,
          instagramUsername: c.instagramUsername,
          isRebook: false,
          status: err instanceof Error ? err.message : String(err),
        });
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    return NextResponse.json({
      ok: true,
      message: `Backfill paidServiceIsRebooking завершено: оновлено ${stats.updated}, помилок ${stats.errors}, пропущено ${stats.skipped}`,
      stats: { ...stats },
      details: details.slice(0, 50),
    });
  } catch (err) {
    console.error('[backfill-paid-service-is-rebooking] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
