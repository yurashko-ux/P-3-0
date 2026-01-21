// web/app/api/admin/direct/debug-altegio-metrics-lock/route.ts
// DEBUG: показує KV-lock для “першого синку” Altegio-метрик по клієнту (без PII).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { kvRead } from '@/lib/kv';

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

  const instagramUsernameRaw = (req.nextUrl.searchParams.get('instagramUsername') || '').toString().trim();
  if (!instagramUsernameRaw) {
    return NextResponse.json({ ok: false, error: 'instagramUsername is required' }, { status: 400 });
  }

  try {
    const instagramUsername = instagramUsernameRaw.toLowerCase();
    const dc = await prisma.directClient.findFirst({
      where: { instagramUsername },
      select: { id: true, instagramUsername: true, altegioClientId: true, phone: true, visits: true, spent: true, lastVisitAt: true },
    });

    if (!dc) {
      return NextResponse.json({ ok: false, error: 'Direct client not found' }, { status: 404 });
    }

    const lockKey = `direct:altegio-metrics-sync:${dc.id}`;
    const raw = await kvRead.getRaw(lockKey);
    let parsed: any = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { rawPreview: String(raw).slice(0, 200) };
      }
    }

    const now = Date.now();
    const inFlightUntil = parsed?.inFlightUntil ? Number(parsed.inFlightUntil) : 0;
    const isInFlight = Boolean(inFlightUntil && inFlightUntil > now);

    return NextResponse.json({
      ok: true,
      directClient: {
        id: dc.id,
        instagramUsername: dc.instagramUsername,
        altegioClientId: dc.altegioClientId ?? null,
        phonePresent: Boolean(dc.phone && dc.phone.trim()),
        visits: dc.visits ?? null,
        spent: dc.spent ?? null,
        lastVisitAtPresent: Boolean(dc.lastVisitAt),
      },
      lockKey,
      lock: parsed
        ? {
            ...parsed,
            lastError: parsed?.lastError ? String(parsed.lastError).slice(0, 300) : undefined,
          }
        : null,
      derived: {
        isInFlight,
        inFlightUntil: inFlightUntil || null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

