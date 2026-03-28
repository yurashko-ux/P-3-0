// Етап 3: підвантаження paidServiceVisitBreakdown з Altegio API для клієнтів,
// у яких є paidServiceVisitId, але порожній breakdown (після communication-meta).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getDirectClient, saveDirectClient } from '@/lib/direct-store';
import { fetchVisitBreakdownFromAPI } from '@/lib/altegio/visits';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MAX_IDS = 200;
/** Обмеження Altegio викликів за один запит (serverless timeout). */
const MAX_FETCH = 25;

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

type Body = { ids?: unknown };

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const rawIds = body.ids;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ ok: false, error: 'Очікується масив ids' }, { status: 400 });
  }

  const ids = rawIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id): id is string => id.length > 0);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, byId: {} });
  }

  if (ids.length > MAX_IDS) {
    return NextResponse.json({ ok: false, error: `Занадто багато id (макс. ${MAX_IDS})` }, { status: 400 });
  }

  const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
  const companyId = parseInt(companyIdStr, 10);
  if (!companyId || Number.isNaN(companyId)) {
    return NextResponse.json({ ok: false, error: 'ALTEGIO_COMPANY_ID не налаштовано' }, { status: 500 });
  }

  const uniqueIds = Array.from(new Set(ids));
  const rows = await prisma.directClient.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      paidServiceVisitId: true,
      paidServiceRecordId: true,
      paidServiceVisitBreakdown: true,
    },
  });

  const byId: Record<string, { paidServiceVisitBreakdown?: unknown; paidServiceTotalCost?: number }> = {};
  let fetched = 0;

  for (const row of rows) {
    if (fetched >= MAX_FETCH) break;
    const visitId = row.paidServiceVisitId;
    if (visitId == null) continue;

    const bd = row.paidServiceVisitBreakdown;
    const hasBd =
      Array.isArray(bd) && bd.length > 0
        ? true
        : typeof bd === 'string' && bd.trim().length > 0
          ? (() => {
              try {
                const p = JSON.parse(bd);
                return Array.isArray(p) && p.length > 0;
              } catch {
                return false;
              }
            })()
          : false;
    if (hasBd) continue;

    const recordId = row.paidServiceRecordId != null ? Number(row.paidServiceRecordId) : undefined;
    const breakdown = await fetchVisitBreakdownFromAPI(Number(visitId), companyId, recordId);
    if (!breakdown || breakdown.length === 0) continue;

    const direct = await getDirectClient(row.id);
    if (!direct) continue;

    const totalCost = breakdown.reduce((a, b) => a + b.sumUAH, 0);
    await saveDirectClient(
      {
        ...direct,
        paidServiceVisitBreakdown: breakdown,
        paidServiceTotalCost: totalCost,
        updatedAt: new Date().toISOString(),
      },
      'visit-breakdown-batch',
      { visitId: Number(visitId), breakdownLength: breakdown.length },
      { touchUpdatedAt: false, skipAltegioMetricsSync: true }
    );

    byId[row.id] = {
      paidServiceVisitBreakdown: breakdown,
      paidServiceTotalCost: totalCost,
    };
    fetched += 1;
  }

  return NextResponse.json({
    ok: true,
    byId,
    meta: { processedRows: fetched, cappedAt: MAX_FETCH },
  });
}
