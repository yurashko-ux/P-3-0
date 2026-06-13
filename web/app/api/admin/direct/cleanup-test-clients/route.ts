// web/app/api/admin/direct/cleanup-test-clients/route.ts
// Масове видалення тестових карток Direct без активних консультацій і записів.

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, deleteDirectClient } from '@/lib/direct-store';
import {
  formatDirectClientDisplayName,
  isDeletableTestClientWithoutVisits,
  isDirectTestClientByName,
  hasActiveConsultationOrBooking,
} from '@/lib/direct-test-client-match';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

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

type DirectClientRow = Awaited<ReturnType<typeof getAllDirectClients>>[number];

function formatVisitDay(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function mapClientRow(client: DirectClientRow, extra?: { skipReason?: string }) {
  const hasConsultation =
    Boolean(client.consultationBookingDate) && !client.consultationDeletedInAltegio;
  const hasBooking =
    (Boolean(client.paidServiceDate) || client.signedUpForPaidService === true) &&
    !client.paidServiceDeletedInAltegio;
  const visitLabels: string[] = [];
  if (hasConsultation) {
    visitLabels.push(
      `консультація ${formatVisitDay(client.consultationBookingDate) || '—'}`
    );
  }
  if (hasBooking) {
    visitLabels.push(`запис ${formatVisitDay(client.paidServiceDate) || '—'}`);
  }
  return {
    id: client.id,
    instagramUsername: client.instagramUsername,
    altegioClientId: client.altegioClientId ?? null,
    name: formatDirectClientDisplayName(client),
    consultationDeletedInAltegio: client.consultationDeletedInAltegio === true,
    paidServiceDeletedInAltegio: client.paidServiceDeletedInAltegio === true,
    hasConsultation,
    hasBooking,
    visitSummary: visitLabels.length > 0 ? visitLabels.join(', ') : null,
    ...(extra?.skipReason ? { skipReason: extra.skipReason } : {}),
  };
}

function partitionTestClients(allClients: DirectClientRow[]) {
  const byName = allClients.filter((c) => isDirectTestClientByName(c));
  const clientsToDelete = byName.filter((c) => isDeletableTestClientWithoutVisits(c));
  const skippedWithVisits = byName.filter(
    (c) => !isDeletableTestClientWithoutVisits(c) && hasActiveConsultationOrBooking(c)
  );
  return { byName, clientsToDelete, skippedWithVisits };
}

/**
 * GET — перегляд усіх кандидатів на видалення (без змін у БД).
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allClients = await getAllDirectClients();
    const { byName, clientsToDelete, skippedWithVisits } = partitionTestClients(allClients);

    return NextResponse.json({
      ok: true,
      message: `До видалення: ${clientsToDelete.length} тестових без консультації та запису (з ${allClients.length} загалом)`,
      stats: {
        totalClients: allClients.length,
        testByName: byName.length,
        toDelete: clientsToDelete.length,
        skippedWithVisits: skippedWithVisits.length,
      },
      clients: clientsToDelete.map((c) => mapClientRow(c)),
      skippedClients: skippedWithVisits.map((c) =>
        mapClientRow(c, { skipReason: 'є активна консультація або запис' })
      ),
      note:
        'Критерії: (1) ім\'я/username містить тест/test/тестов/demo/«Хочу запис…»; (2) немає дати консультації та запису (або позначено «Видалено в Altegio»). POST — видалити всіх кандидатів одразу.',
    });
  } catch (error) {
    console.error('[direct/cleanup-test-clients] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST — видалити всіх тестових клієнтів без консультації та запису.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allClients = await getAllDirectClients();
    const { byName, clientsToDelete, skippedWithVisits } = partitionTestClients(allClients);

    console.log(
      `[direct/cleanup-test-clients] testByName=${byName.length}, toDelete=${clientsToDelete.length}, skippedWithVisits=${skippedWithVisits.length}, total=${allClients.length}`
    );

    const deleted: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const client of clientsToDelete) {
      try {
        await deleteDirectClient(client.id);
        deleted.push(client.id);
        console.log(
          `[direct/cleanup-test-clients] ✅ Deleted ${client.id} (${formatDirectClientDisplayName(client)}, @${client.instagramUsername})`
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push({ id: client.id, error: errorMsg });
        console.error(`[direct/cleanup-test-clients] ❌ Failed ${client.id}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Видалено ${deleted.length} тестових клієнтів (без консультації та запису)`,
      stats: {
        totalClients: allClients.length,
        testByName: byName.length,
        foundToDelete: clientsToDelete.length,
        deleted: deleted.length,
        skippedWithVisits: skippedWithVisits.length,
        errors: errors.length,
      },
      deletedClients: clientsToDelete
        .filter((c) => deleted.includes(c.id))
        .map((c) => mapClientRow(c)),
      skippedClients: skippedWithVisits.map((c) =>
        mapClientRow(c, { skipReason: 'є активна консультація або запис' })
      ),
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error('[direct/cleanup-test-clients] POST error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
