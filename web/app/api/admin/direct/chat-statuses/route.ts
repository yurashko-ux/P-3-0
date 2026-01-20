// web/app/api/admin/direct/chat-statuses/route.ts
// CRUD (частково) для статусів переписки Direct.

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const includeInactive = req.nextUrl.searchParams.get('includeInactive') === '1';
    const statuses = await prisma.directChatStatus.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ ok: true, statuses });
  } catch (err) {
    console.error('[direct/chat-statuses] ❌ GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const name = (body?.name || '').toString().trim();
    const color = (body?.color || '').toString().trim() || '#6b7280';
    const orderRaw = body?.order;
    const order = typeof orderRaw === 'number' ? orderRaw : Number(orderRaw);

    if (!name) {
      return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
    }

    const created = await prisma.directChatStatus.create({
      data: {
        name,
        color,
        order: Number.isFinite(order) ? order : 0,
        isActive: true,
      },
    });

    console.log('[direct/chat-statuses] ✅ Created chat status:', {
      id: created.id,
      name: created.name,
      color: created.color,
      order: created.order,
    });

    return NextResponse.json({ ok: true, status: created });
  } catch (err) {
    console.error('[direct/chat-statuses] ❌ POST error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

