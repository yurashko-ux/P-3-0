// web/app/api/admin/direct/chat-statuses/[id]/route.ts
// Редагування статусу переписки Direct.

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

    if (body?.name !== undefined) data.name = (body.name || '').toString().trim();
    if (body?.color !== undefined) data.color = (body.color || '').toString().trim() || '#6b7280';
    if (body?.order !== undefined) {
      const n = typeof body.order === 'number' ? body.order : Number(body.order);
      if (Number.isFinite(n)) data.order = n;
    }
    if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await prisma.directChatStatus.update({
      where: { id },
      data,
    });

    console.log('[direct/chat-statuses] ✅ Updated chat status:', { id: updated.id, name: updated.name });
    return NextResponse.json({ ok: true, status: updated });
  } catch (err) {
    console.error('[direct/chat-statuses] ❌ PATCH error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

