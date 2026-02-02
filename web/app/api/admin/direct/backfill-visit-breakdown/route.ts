// web/app/api/admin/direct/backfill-visit-breakdown/route.ts
// Backfill paidServiceVisitId та paidServiceVisitBreakdown з API (GET /visits + visit/details, тільки items).
// Для клієнтів з paidServiceDate беремо visitId з KV (групи за днем), викликаємо API, зберігаємо в БД.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import {
  normalizeRecordsLogItems,
  groupRecordsByClientDay,
  getMainVisitIdFromGroup,
  kyivDayFromISO,
} from '@/lib/altegio/records-grouping';
import { fetchVisitBreakdownFromAPI } from '@/lib/altegio/visits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const ALTEGIO_COMPANY_ID = process.env.ALTEGIO_COMPANY_ID || '';

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

  const companyId = parseInt(ALTEGIO_COMPANY_ID, 10);
  if (!companyId || Number.isNaN(companyId)) {
    return NextResponse.json({
      ok: false,
      error: 'ALTEGIO_COMPANY_ID не налаштовано',
    }, { status: 400 });
  }

  try {
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    const clients = await prisma.directClient.findMany({
      where: {
        altegioClientId: { not: null },
        paidServiceDate: { not: null },
      },
      select: {
        id: true,
        instagramUsername: true,
        altegioClientId: true,
        paidServiceDate: true,
        paidServiceVisitId: true,
      },
    });

    let updated = 0;
    let errors = 0;

    for (const client of clients) {
      const altegioClientId = client.altegioClientId!;
      const paidServiceDate = client.paidServiceDate!;
      const paidKyivDay = kyivDayFromISO(paidServiceDate.toISOString?.() ?? String(paidServiceDate));
      if (!paidKyivDay) continue;

      const groups = groupsByClient.get(altegioClientId) || [];
      const paidGroup = groups.find(
        (g: { groupType?: string; kyivDay?: string }) =>
          g?.groupType === 'paid' && (g?.kyivDay || '') === paidKyivDay
      );
      if (!paidGroup) continue;

      const visitId = getMainVisitIdFromGroup(paidGroup as any);
      if (visitId == null) continue;

      try {
        const breakdown = await fetchVisitBreakdownFromAPI(visitId, companyId);
        if (!breakdown || breakdown.length === 0) continue;

        await prisma.directClient.update({
          where: { id: client.id },
          data: {
            paidServiceVisitId: visitId,
            paidServiceVisitBreakdown: breakdown as any,
          },
        });
        updated++;
      } catch (err) {
        errors++;
        console.warn('[backfill-visit-breakdown] client', client.id, client.instagramUsername, err);
      }
    }

    return NextResponse.json({
      ok: true,
      total: clients.length,
      updated,
      errors,
    });
  } catch (err) {
    console.error('[backfill-visit-breakdown]', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
