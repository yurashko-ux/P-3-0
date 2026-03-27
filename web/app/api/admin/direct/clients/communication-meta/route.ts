// web/app/api/admin/direct/clients/communication-meta/route.ts
// Етап 2: метадані переписки (Inst) та дзвінків після швидкого списку клієнтів.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { prismaClientToDirectClient } from '@/lib/direct-store';
import {
  buildCommunicationMetaById,
  enrichDirectClientsCommunicationMeta,
} from '@/lib/direct-clients-communication-meta';
import { verifyUserToken } from '@/lib/auth-rbac';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
/** Узгоджено з lightweight GET /api/admin/direct/clients (Math.min(200, limit)). Не export — Next.js не дозволяє довільні експорти в route.ts. */
const COMMUNICATION_META_MAX_IDS = 200;

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

  const started = Date.now();
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

  if (ids.length > COMMUNICATION_META_MAX_IDS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Занадто багато id (макс. ${COMMUNICATION_META_MAX_IDS})`,
      },
      { status: 400 }
    );
  }

  const uniqueIds = Array.from(new Set(ids));

  try {
    const rows = await prisma.directClient.findMany({
      where: { id: { in: uniqueIds } },
    });

    const clients = rows.map((r) => prismaClientToDirectClient(r));
    const enriched = await enrichDirectClientsCommunicationMeta(clients);
    const byId = buildCommunicationMetaById(enriched);

    console.log(
      `[direct/clients/communication-meta] ok: ${uniqueIds.length} id, ${rows.length} у БД, ${Date.now() - started}ms`
    );

    return NextResponse.json(
      { ok: true, byId },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (err) {
    console.error('[direct/clients/communication-meta] помилка:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
