// web/app/api/admin/direct/clients/[id]/chat-status-history/route.ts
// Історія змін статусів переписки для клієнта.

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

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = (ctx?.params?.id || '').toString();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: 'client id is required' }, { status: 400 });
    }

    const limitRaw = req.nextUrl.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitRaw || 50) || 50));

    const logs = await prisma.directClientChatStatusLog.findMany({
      where: { clientId },
      orderBy: [{ changedAt: 'desc' }],
      take: limit,
      include: {
        fromStatus: { select: { id: true, name: true, color: true } },
        toStatus: { select: { id: true, name: true, color: true } },
      },
    });

    return NextResponse.json({ ok: true, clientId, total: logs.length, logs });
  } catch (err) {
    console.error('[direct/chat-status-history] ❌ GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

