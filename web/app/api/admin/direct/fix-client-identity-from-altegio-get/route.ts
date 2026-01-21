// web/app/api/admin/direct/fix-client-identity-from-altegio-get/route.ts
// Browser-friendly GET wrapper for identity repair (phone + name from Altegio) by altegioClientId.
// NOTE: We keep this separate because prod currently returns 405 for GET on the POST endpoint.
// No PII is returned.

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByAltegioId, saveDirectClient } from '@/lib/direct-store';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';
import { getClient } from '@/lib/altegio/clients';

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

function withCookieIfToken(req: NextRequest, res: NextResponse) {
  const token = (req.nextUrl.searchParams.get('token') || '').toString();
  if (token && ADMIN_PASS && token === ADMIN_PASS) {
    res.cookies.set('admin_token', ADMIN_PASS, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}

export async function GET(req: NextRequest) {
  // Якщо зайшли через ?token= — поставимо cookie, щоб не логінитись вдруге
  const token = (req.nextUrl.searchParams.get('token') || '').toString();
  if (token && ADMIN_PASS && token === ADMIN_PASS) {
    const res = NextResponse.json({ ok: true, note: 'token accepted, cookie set. Re-run without token to execute.' });
    return withCookieIfToken(req, res);
  }

  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const altegioClientId = Number(req.nextUrl.searchParams.get('altegioClientId') || '');
  if (!altegioClientId || Number.isNaN(altegioClientId)) {
    return NextResponse.json({ ok: false, error: 'altegioClientId required' }, { status: 400 });
  }

  const current = await getDirectClientByAltegioId(altegioClientId);
  if (!current) {
    return NextResponse.json({ ok: false, error: 'direct_client_not_found' }, { status: 404 });
  }

  const updates: any = {};
  const changedKeys: string[] = [];

  try {
    const m = await fetchAltegioClientMetrics({ altegioClientId });
    if (m.ok) {
      const nextPhone = m.metrics.phone ? String(m.metrics.phone).trim() : '';
      if (nextPhone && (!current.phone || current.phone.trim() !== nextPhone)) {
        updates.phone = nextPhone;
        changedKeys.push('phone');
      }
      if (m.metrics.visits !== null && m.metrics.visits !== undefined && current.visits !== m.metrics.visits) {
        updates.visits = m.metrics.visits;
        changedKeys.push('visits');
      }
      if (m.metrics.spent !== null && m.metrics.spent !== undefined && current.spent !== m.metrics.spent) {
        updates.spent = m.metrics.spent;
        changedKeys.push('spent');
      }
    }
  } catch {}

  try {
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (companyId && !Number.isNaN(companyId)) {
      const a = await getClient(companyId, altegioClientId);
      const full = (a as any)?.name ? String((a as any).name).trim() : '';
      if (full && !full.includes('{{') && !full.includes('}}')) {
        const parts = full.split(/\s+/).filter(Boolean);
        const firstName = parts[0] || '';
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
        if (firstName && (!current.firstName || current.firstName.trim() !== firstName)) {
          updates.firstName = firstName;
          changedKeys.push('firstName');
        }
        if (lastName && (!current.lastName || current.lastName.trim() !== lastName)) {
          updates.lastName = lastName;
          changedKeys.push('lastName');
        }
      }
    }
  } catch {}

  if (!changedKeys.length) {
    return NextResponse.json({ ok: true, altegioClientId, directClientId: current.id, changedKeys: [], note: 'no_changes' });
  }

  const next = { ...current, ...updates, updatedAt: current.updatedAt };

  // #region agent log
  try {
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'merge-2',hypothesisId:'H_fix_405',location:'web/app/api/admin/direct/fix-client-identity-from-altegio-get/route.ts:GET',message:'GET repair executed',data:{altegioClientId,directClientId:String(current.id).slice(0,12),changedKeys},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion agent log

  await saveDirectClient(
    next as any,
    'admin-fix-identity-from-altegio-get',
    { altegioClientId, changedKeys },
    { touchUpdatedAt: false, skipAltegioMetricsSync: true },
  );

  return NextResponse.json({
    ok: true,
    altegioClientId,
    directClientId: current.id,
    changedKeys,
    phonePresent: Boolean((next as any).phone),
    firstNamePresent: Boolean((next as any).firstName),
    lastNamePresent: Boolean((next as any).lastName),
  });
}

