// web/app/api/admin/direct/call-statuses/[id]/route.ts
// Редагування статусу дзвінків Direct.

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

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const id = (ctx?.params?.id || '').toString();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const data: any = {};

    if (body?.name !== undefined) {
      const name = (body.name || '').toString().trim();
      if (name.length > STATUS_NAME_MAX_LEN) {
        return NextResponse.json(
          { ok: false, error: `name is too long (max ${STATUS_NAME_MAX_LEN})` },
          { status: 400 }
        );
      }
      data.name = name;
    }
    if (body?.badgeKey !== undefined) {
      const badgeKey = (body.badgeKey || '').toString().trim();
      if (!ALLOWED_BADGE_KEYS.includes(badgeKey)) {
        return NextResponse.json(
          { ok: false, error: `badgeKey is invalid. Allowed: ${ALLOWED_BADGE_KEYS.join(', ')}` },
          { status: 400 }
        );
      }
      data.badgeKey = badgeKey;
    }
    if (body?.order !== undefined) {
      const n = typeof body.order === 'number' ? body.order : Number(body.order);
      if (Number.isFinite(n)) data.order = n;
    }
    if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await prisma.directCallStatus.update({
      where: { id },
      data,
    });

    console.log('[direct/call-statuses] ✅ Updated call status:', { id: updated.id, name: updated.name });
    return NextResponse.json({ ok: true, status: updated });
  } catch (err) {
    console.error('[direct/call-statuses] ❌ PATCH error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
