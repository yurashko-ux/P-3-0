// web/app/api/admin/direct/call-statuses/route.ts
// CRUD (частково) для статусів дзвінків Direct.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

const ALLOWED_BADGE_KEYS = Array.from({ length: 10 }, (_, i) => `badge_${i + 1}`);
const STATUS_NAME_MAX_LEN = 24;

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
    const statuses = await prisma.directCallStatus.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ ok: true, statuses });
  } catch (err) {
    console.error('[direct/call-statuses] ❌ GET error:', err);
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
    const badgeKey = (body?.badgeKey || '').toString().trim() || 'badge_1';
    const orderRaw = body?.order;
    const order = typeof orderRaw === 'number' ? orderRaw : Number(orderRaw);

    if (!name) {
      return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
    }
    if (name.length > STATUS_NAME_MAX_LEN) {
      return NextResponse.json(
        { ok: false, error: `name is too long (max ${STATUS_NAME_MAX_LEN})` },
        { status: 400 }
      );
    }
    if (!ALLOWED_BADGE_KEYS.includes(badgeKey)) {
      return NextResponse.json(
        { ok: false, error: `badgeKey is invalid. Allowed: ${ALLOWED_BADGE_KEYS.join(', ')}` },
        { status: 400 }
      );
    }

    const created = await prisma.directCallStatus.create({
      data: {
        name,
        badgeKey,
        order: Number.isFinite(order) ? order : 0,
        isActive: true,
      },
    });

    console.log('[direct/call-statuses] ✅ Created call status:', {
      id: created.id,
      name: created.name,
      badgeKey: (created as any).badgeKey,
      order: created.order,
    });

    return NextResponse.json({ ok: true, status: created });
  } catch (err) {
    console.error('[direct/call-statuses] ❌ POST error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
