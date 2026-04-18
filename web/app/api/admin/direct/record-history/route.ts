// web/app/api/admin/direct/record-history/route.ts
// Історія записів/консультацій. API-first: Altegio GET /records як джерело.
// Fallback на KV (webhook log), якщо API не відповідає або повертає порожньо.
// Self-heal Prisma: спільний модуль з фоновим reconcile таблиці Direct.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import {
  loadAltegioRecordGroupsForClient,
  mapAltegioGroupToApiRow,
  prismaSelfHealDirectClientFromRecordGroups,
} from '@/lib/direct-reconcile-altegio-record-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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

/**
 * GET - отримати історію по клієнту
 * Query:
 *  - altegioClientId: number (required)
 *  - type: 'paid' | 'consultation' (required)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const altegioClientIdParam = req.nextUrl.searchParams.get('altegioClientId');
    const typeParam = req.nextUrl.searchParams.get('type');

    if (!altegioClientIdParam) {
      return NextResponse.json({ ok: false, error: 'altegioClientId is required' }, { status: 400 });
    }
    const altegioClientId = parseInt(altegioClientIdParam, 10);
    if (isNaN(altegioClientId)) {
      return NextResponse.json({ ok: false, error: 'Invalid altegioClientId' }, { status: 400 });
    }

    const type = typeParam === 'paid' || typeParam === 'consultation' ? typeParam : null;
    if (!type) {
      return NextResponse.json({ ok: false, error: "type must be 'paid' or 'consultation'" }, { status: 400 });
    }

    console.log(`[direct/record-history] 🔍 Fetching history for altegioClientId=${altegioClientId}, type=${type}`);

    if (type === 'consultation') {
      try {
        const client = await prisma.directClient.findFirst({
          where: { altegioClientId },
          select: { visits: true, consultationBookingDate: true },
        });
        const hadConsult = Boolean(client?.consultationBookingDate);
        const shouldIgnoreConsult = (client?.visits ?? 0) >= 2 && !hadConsult;
        if (shouldIgnoreConsult) {
          return NextResponse.json({
            ok: true,
            altegioClientId,
            type,
            total: 0,
            rows: [],
            selfHealedPaidAttendance: false,
            selfHealedConsultationAttendance: false,
            debug: {
              ignoredReason: 'repeat-client-visits>=2',
              hadConsult,
            },
          });
        }
      } catch (err) {
        console.warn('[direct/record-history] ⚠️ Не вдалося перевірити visits (продовжуємо без фільтра):', err);
      }
    }

    const { allGroups, dataSource, recordsLogCount, webhookLogCount, normalizedCount } =
      await loadAltegioRecordGroupsForClient(altegioClientId);

    const mapGroupToRow = (g: (typeof allGroups)[number]) => mapAltegioGroupToApiRow(g);

    const rows = allGroups.filter((g) => g.groupType === type).map(mapGroupToRow);

    const heal = await prismaSelfHealDirectClientFromRecordGroups(altegioClientId, allGroups);

    return NextResponse.json({
      ok: true,
      altegioClientId,
      type,
      total: rows.length,
      rows,
      selfHealedPaidAttendance: heal.selfHealedPaidAttendance,
      selfHealedConsultationAttendance: heal.selfHealedConsultationAttendance,
      debug: {
        dataSource,
        recordsLogCount,
        webhookLogCount,
        normalizedCount,
        allGroupsCount: allGroups.length,
      },
    });
  } catch (error) {
    console.error('[direct/record-history] ❌ Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
