// POST — фонове вирівнювання статусів записів Altegio → Prisma для видимих у таблиці клієнтів.
// Викликається з Direct після завантаження сторінки (обмежена кількість id за один запит).

import { NextRequest, NextResponse } from 'next/server';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import { reconcileDirectClientRecordsFromAltegio } from '@/lib/direct-reconcile-altegio-record-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

const MAX_IDS = 36;

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { altegioClientIds?: unknown };
    const raw = body?.altegioClientIds;
    if (!Array.isArray(raw)) {
      return NextResponse.json({ ok: false, error: 'altegioClientIds must be an array' }, { status: 400 });
    }
    const ids = [...new Set(raw.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0))].slice(
      0,
      MAX_IDS
    );

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, reconciledClients: 0, details: [] });
    }

    console.log(`[direct/reconcile-visible-records] 🔄 Старт reconcile для ${ids.length} клієнтів Altegio`);

    let reconciledClients = 0;
    const details: Array<{
      altegioClientId: number;
      selfHealedPaidAttendance: boolean;
      selfHealedConsultationAttendance: boolean;
      selfHealedConsultationDates: boolean;
      error?: string;
    }> = [];

    for (const altegioClientId of ids) {
      try {
        const r = await reconcileDirectClientRecordsFromAltegio(altegioClientId);
        const touched =
          r.selfHealedPaidAttendance || r.selfHealedConsultationAttendance || r.selfHealedConsultationDates;
        if (touched) reconciledClients++;
        details.push({
          altegioClientId,
          selfHealedPaidAttendance: r.selfHealedPaidAttendance,
          selfHealedConsultationAttendance: r.selfHealedConsultationAttendance,
          selfHealedConsultationDates: r.selfHealedConsultationDates,
        });
      } catch (e) {
        details.push({
          altegioClientId,
          selfHealedPaidAttendance: false,
          selfHealedConsultationAttendance: false,
          selfHealedConsultationDates: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    console.log(`[direct/reconcile-visible-records] ✅ Завершено: змінено ${reconciledClients} клієнтів`);

    return NextResponse.json({
      ok: true,
      reconciledClients,
      details,
    });
  } catch (error) {
    console.error('[direct/reconcile-visible-records] ❌', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
