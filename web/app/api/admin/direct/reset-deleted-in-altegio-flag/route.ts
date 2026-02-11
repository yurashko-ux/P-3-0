// web/app/api/admin/direct/reset-deleted-in-altegio-flag/route.ts
// Скидає прапорці *DeletedInAltegio, щоб вебхуки/sync знову могли синхронізувати дані з Altegio.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

type ResetType = 'paid' | 'consultation' | 'both';

/**
 * POST — скинути прапорці consultationDeletedInAltegio та/або paidServiceDeletedInAltegio.
 * Після цього вебхуки та sync з Altegio знову зможуть записувати консультацію/платний запис.
 * Body: { altegioClientId: number, type?: 'paid' | 'consultation' | 'both' }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const altegioClientIdParam = body.altegioClientId;
    const type: ResetType = body.type === 'consultation' || body.type === 'paid' ? body.type : 'both';

    if (altegioClientIdParam == null || altegioClientIdParam === '') {
      return NextResponse.json(
        { ok: false, error: 'Вкажіть altegioClientId (ID клієнта в Altegio)' },
        { status: 400 }
      );
    }

    const altegioId = parseInt(String(altegioClientIdParam), 10);
    if (!Number.isFinite(altegioId)) {
      return NextResponse.json(
        { ok: false, error: 'altegioClientId має бути числом' },
        { status: 400 }
      );
    }

    const client = await prisma.directClient.findFirst({
      where: { altegioClientId: altegioId },
    });

    if (!client) {
      return NextResponse.json(
        { ok: false, error: 'Клієнта не знайдено' },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (type === 'consultation' || type === 'both') {
      updates.consultationDeletedInAltegio = false;
    }
    if (type === 'paid' || type === 'both') {
      updates.paidServiceDeletedInAltegio = false;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'Нічого не змінено',
        clientId: client.id,
        altegioClientId: client.altegioClientId,
        instagramUsername: client.instagramUsername,
      });
    }

    const sameUsername = (client.instagramUsername ?? '').toString().trim();
    const updatedIds: string[] = [client.id];

    await prisma.directClient.update({
      where: { id: client.id },
      data: updates as Record<string, boolean>,
    });

    if (sameUsername) {
      const others = await prisma.directClient.findMany({
        where: {
          id: { not: client.id },
          instagramUsername: { equals: sameUsername, mode: 'insensitive' },
        },
        select: { id: true },
      });
      for (const other of others) {
        await prisma.directClient.update({
          where: { id: other.id },
          data: updates as Record<string, boolean>,
        });
        updatedIds.push(other.id);
      }
    }

    const parts: string[] = [];
    if (type === 'consultation' || type === 'both') parts.push('консультацію');
    if (type === 'paid' || type === 'both') parts.push('платний запис');

    return NextResponse.json({
      ok: true,
      message: `Прапорець «Видалено в Altegio» скинуто для ${parts.join(' та ')}. Запустіть синхронізацію, щоб підтягнути дані з Altegio.`,
      clientId: client.id,
      altegioClientId: client.altegioClientId,
      instagramUsername: client.instagramUsername,
      resetType: type,
      updatedCount: updatedIds.length,
    });
  } catch (error) {
    console.error('[reset-deleted-in-altegio-flag] Error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
