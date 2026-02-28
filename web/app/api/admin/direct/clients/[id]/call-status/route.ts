// web/app/api/admin/direct/clients/[id]/call-status/route.ts
// Призначення статусу дзвінків для клієнта.
// Спрощена версія chat-status: тільки callStatusId, callStatusSetAt, лог.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = (ctx?.params?.id || '').toString();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: 'client id is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const statusIdRaw = body?.statusId;
    const nextStatusId =
      statusIdRaw === null || statusIdRaw === undefined || String(statusIdRaw).trim() === ''
        ? null
        : String(statusIdRaw).trim();

    const existing = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { id: true, callStatusId: true, callStatusSetAt: true },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const prevStatusId = existing.callStatusId ?? null;
    const changed = prevStatusId !== nextStatusId;
    const now = new Date();

    // Перевіримо, що статус існує і активний (якщо вказано)
    if (nextStatusId) {
      const status = await prisma.directCallStatus.findUnique({
        where: { id: nextStatusId },
        select: { id: true, isActive: true, name: true },
      });
      if (!status) {
        return NextResponse.json({ ok: false, error: 'Call status not found' }, { status: 404 });
      }
      if (!status.isActive) {
        return NextResponse.json({ ok: false, error: 'Call status is inactive' }, { status: 400 });
      }
    }

    const updated = await prisma.directClient.update({
      where: { id: clientId },
      data: {
        callStatusId: nextStatusId,
        callStatusSetAt: changed ? (nextStatusId ? now : null) : existing.callStatusSetAt,
      },
      select: { id: true, callStatusId: true, callStatusSetAt: true },
    });

    if (changed) {
      await prisma.directClientCallStatusLog.create({
        data: {
          clientId,
          fromStatusId: prevStatusId,
          toStatusId: nextStatusId,
          changedAt: now,
          changedBy: 'admin',
          note: null,
        },
      });
      console.log('[direct/call-status] ✅ Status changed:', { clientId, from: prevStatusId, to: nextStatusId });
    }

    return NextResponse.json({ ok: true, changed, client: updated });
  } catch (err) {
    console.error('[direct/call-status] ❌ POST error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
