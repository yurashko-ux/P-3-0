// web/app/api/admin/direct/backfill-visit-breakdown/route.ts
// Backfill paidServiceVisitId, paidServiceVisitBreakdown, paidServiceTotalCost з API Altegio.
// Тільки API: visitId беремо з GET /records (за client_id + дата), breakdown — з GET /visits + /visit/details.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { fetchVisitBreakdownFromAPI } from '@/lib/altegio/visits';
import { getClientRecords, isConsultationService } from '@/lib/altegio/records';

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
    let noRecords = 0;
    let noMatchingRecord = 0;
    let noBreakdown = 0;
    const details: Array<{ instagram: string; reason: string; visitId?: number }> = [];

    for (const client of clients) {
      const altegioClientId = client.altegioClientId!;
      const paidServiceDate = client.paidServiceDate!;
      const paidKyivDay = kyivDayFromISO(paidServiceDate.toISOString?.() ?? String(paidServiceDate));
      if (!paidKyivDay) {
        details.push({ instagram: client.instagramUsername, reason: 'no kyivDay from paidServiceDate' });
        continue;
      }

      let visitId: number | null = null;
      try {
        const records = await getClientRecords(companyId, altegioClientId);
        if (!records.length) {
          noRecords++;
          if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'API returned no records' });
          continue;
        }

        const dayRecords = records.filter((r) => {
          if (!r.date) return false;
          return kyivDayFromISO(r.date) === paidKyivDay;
        });
        const paidRecord = dayRecords.find((r) => !isConsultationService(r.services ?? []).isConsultation) ?? dayRecords[0];
        if (!paidRecord || paidRecord.visit_id == null) {
          noMatchingRecord++;
          if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'no record matching paidServiceDate', visitId: undefined });
          continue;
        }
        visitId = paidRecord.visit_id;
      } catch (err) {
        noRecords++;
        if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: `getClientRecords error: ${err instanceof Error ? err.message : err}` });
        continue;
      }

      if (visitId == null) {
        noMatchingRecord++;
        continue;
      }

      try {
        const breakdown = await fetchVisitBreakdownFromAPI(visitId, companyId);
        if (!breakdown || breakdown.length === 0) {
          noBreakdown++;
          if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'API returned empty breakdown', visitId });
          continue;
        }

        const totalCost = breakdown.reduce((a, b) => a + b.sumUAH, 0);

        await prisma.directClient.update({
          where: { id: client.id },
          data: {
            paidServiceVisitId: visitId,
            paidServiceVisitBreakdown: breakdown as any,
            paidServiceTotalCost: totalCost,
          },
        });
        updated++;
        if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: 'updated', visitId });
      } catch (err) {
        errors++;
        if (details.length < 10) details.push({ instagram: client.instagramUsername, reason: `error: ${err instanceof Error ? err.message : String(err)}`, visitId });
        console.warn('[backfill-visit-breakdown] client', client.id, client.instagramUsername, err);
      }
    }

    return NextResponse.json({
      ok: true,
      total: clients.length,
      updated,
      errors,
      noRecords,
      noMatchingRecord,
      noBreakdown,
      details,
      note: 'Тільки API Altegio (GET /records, GET /visits, GET /visit/details). Без KV.',
    });
  } catch (err) {
    console.error('[backfill-visit-breakdown]', err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
