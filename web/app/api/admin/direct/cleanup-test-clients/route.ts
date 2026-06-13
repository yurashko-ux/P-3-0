// web/app/api/admin/direct/cleanup-test-clients/route.ts
// Масове видалення тестових карток Direct (ім'я / username містить тест, test, тестов тощо).

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, deleteDirectClient } from '@/lib/direct-store';
import {
  formatDirectClientDisplayName,
  isDirectTestClientByName,
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

function mapClientRow(client: {
  id: string;
  instagramUsername: string;
  altegioClientId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  consultationDeletedInAltegio?: boolean;
  paidServiceDeletedInAltegio?: boolean;
}) {
  return {
    id: client.id,
    instagramUsername: client.instagramUsername,
    altegioClientId: client.altegioClientId ?? null,
    name: formatDirectClientDisplayName(client),
    consultationDeletedInAltegio: client.consultationDeletedInAltegio === true,
    paidServiceDeletedInAltegio: client.paidServiceDeletedInAltegio === true,
  };
}

function findTestClients(allClients: Awaited<ReturnType<typeof getAllDirectClients>>) {
  return allClients.filter((c) => isDirectTestClientByName(c));
}

/**
 * GET — перегляд кандидатів на видалення (без змін у БД).
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allClients = await getAllDirectClients();
    const clientsToDelete = findTestClients(allClients);

    return NextResponse.json({
      ok: true,
      message: `Знайдено ${clientsToDelete.length} тестових клієнтів (з ${allClients.length} загалом)`,
      stats: {
        totalClients: allClients.length,
        toDelete: clientsToDelete.length,
      },
      clients: clientsToDelete.map(mapClientRow),
      note:
        'Критерій: ім\'я або Instagram містить «тест», «test», «тестов», «demo» або «Хочу запис…». POST — видалити.',
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
 * POST — видалити всіх тестових клієнтів за іменем.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allClients = await getAllDirectClients();
    const clientsToDelete = findTestClients(allClients);

    console.log(
      `[direct/cleanup-test-clients] Found ${clientsToDelete.length} test clients to delete (out of ${allClients.length})`
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
      message: `Видалено ${deleted.length} тестових клієнтів`,
      stats: {
        totalClients: allClients.length,
        foundToDelete: clientsToDelete.length,
        deleted: deleted.length,
        errors: errors.length,
      },
      deletedClients: clientsToDelete.map(mapClientRow),
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
