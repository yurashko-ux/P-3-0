// Ручна відправка в Telegram прохання вказати Instagram для клієнта з Altegio.

import { NextRequest, NextResponse } from 'next/server';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import { sendMissingInstagramTelegramRequest } from '@/lib/direct-reminders/missing-instagram-notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  const headerToken = req.headers.get('x-admin-token') || '';
  if (headerToken && ADMIN_PASS && headerToken === ADMIN_PASS) return true;
  if (headerToken && verifyUserToken(headerToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const altegioClientId = parseInt(String(body?.altegioClientId ?? ''), 10);
    if (!Number.isFinite(altegioClientId)) {
      return NextResponse.json({ ok: false, error: 'Потрібен Altegio ID' }, { status: 400 });
    }

    const result = await sendMissingInstagramTelegramRequest({
      altegioClientId,
      fallbackName: typeof body?.clientName === 'string' ? body.clientName : undefined,
      fallbackPhone: typeof body?.phone === 'string' ? body.phone : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[request-missing-instagram] Помилка:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
