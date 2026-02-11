// web/app/api/admin/direct/sync-last-visit/route.ts
// Ручний синк: заповнити lastVisitAt (Altegio last_visit_date) для Direct клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { fetchAltegioLastVisitMap } from '@/lib/altegio/last-visit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

async function run(req: NextRequest) {
  // Якщо зайшли через ?token= — поставимо cookie, щоб не логінитись вдруге
  const token = (req.nextUrl.searchParams.get('token') || '').toString();
  if (token && ADMIN_PASS && token === ADMIN_PASS) {
    const ok = true;
    const res = NextResponse.json({ ok, note: 'token accepted, cookie set. Re-run without token to execute.' });
    return withCookieIfToken(req, res);
  }

  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
  const companyId = parseInt(companyIdStr, 10);
  if (!companyId || Number.isNaN(companyId)) {
    return NextResponse.json({ ok: false, error: 'ALTEGIO_COMPANY_ID not configured' }, { status: 500 });
  }

  const limit = Math.max(0, Math.min(5000, Number(req.nextUrl.searchParams.get('limit') || '0') || 0));
  const delayMs = Math.max(0, Math.min(2000, Number(req.nextUrl.searchParams.get('delayMs') || '150') || 150));
  const lvPages = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get('lvPages') || '60') || 60));
  const lvPageSize = Math.max(10, Math.min(200, Number(req.nextUrl.searchParams.get('lvPageSize') || '100') || 100));
  const targetAltegioClientId = Number(req.nextUrl.searchParams.get('altegioClientId') || '');
  const hasTarget = Boolean(targetAltegioClientId && Number.isFinite(targetAltegioClientId));
  const onlyMissing = (req.nextUrl.searchParams.get('onlyMissing') || (hasTarget ? '0' : '1')) === '1';
  const dryRun = (req.nextUrl.searchParams.get('dryRun') || '0') === '1';

  console.log('[admin/sync-last-visit] Старт', {
    companyId,
    limit,
    delayMs,
    lvPages,
    lvPageSize,
    onlyMissing,
    dryRun,
    targetAltegioClientId: hasTarget ? targetAltegioClientId : null,
  });

  const lastVisitMap = await fetchAltegioLastVisitMap({
    companyId,
    maxPages: lvPages,
    pageSize: lvPageSize,
    delayMs,
  });

  const allClients = await getAllDirectClients();
  const targetsAll = allClients.filter((c) => typeof c.altegioClientId === 'number' && (c.altegioClientId || 0) > 0);
  const targets = hasTarget
    ? targetsAll.filter((c) => Number(c.altegioClientId) === Number(targetAltegioClientId))
    : targetsAll;

  let processed = 0;
  let updated = 0;
  let skippedNoAltegioId = allClients.length - targets.length;
  let skippedNoLastVisit = 0;
  let skippedExists = 0;
  let skippedNoChange = 0;
  let errors = 0;

  const samples: Array<{ directClientId: string; altegioClientId: number; action: string; lastVisitAt?: string }> = [];
  const errorDetails: Array<{ directClientId: string; altegioClientId: number; error: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const client = targets[i];
    if (!client.altegioClientId) continue;
    if (limit && processed >= limit) break;
    processed++;

    try {
      const lv = lastVisitMap.get(client.altegioClientId) || '';
      if (!lv) {
        skippedNoLastVisit++;
        continue;
      }

      const current = (client as any).lastVisitAt ? String((client as any).lastVisitAt) : '';
      if (onlyMissing && current) {
        skippedExists++;
        continue;
      }

      const currentTs = current ? new Date(current).getTime() : NaN;
      const nextTs = new Date(lv).getTime();
      if (!Number.isFinite(nextTs)) {
        skippedNoLastVisit++;
        continue;
      }

      if (Number.isFinite(currentTs) && currentTs === nextTs) {
        skippedNoChange++;
        continue;
      }

      if (dryRun) {
        if (samples.length < 20) {
          samples.push({ directClientId: client.id, altegioClientId: client.altegioClientId, action: 'dry_run', lastVisitAt: new Date(nextTs).toISOString() });
        }
        continue;
      }

      const updatedClient: any = {
        ...client,
        lastVisitAt: new Date(nextTs).toISOString(),
        // НЕ рухаємо updatedAt (це технічний синк)
        updatedAt: client.updatedAt,
      };

      await saveDirectClient(
        updatedClient,
        'admin-sync-last-visit',
        { altegioClientId: client.altegioClientId },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );

      updated++;
      if (samples.length < 20) {
        samples.push({ directClientId: client.id, altegioClientId: client.altegioClientId, action: 'saved', lastVisitAt: updatedClient.lastVisitAt });
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ directClientId: client.id, altegioClientId: client.altegioClientId!, error: msg });
      console.error('[admin/sync-last-visit] ❌ Помилка', { directClientId: client.id, altegioClientId: client.altegioClientId, error: msg });
    }
  }

  const ms = Date.now() - startedAt;
  console.log('[admin/sync-last-visit] ✅ Готово', {
    totalClients: allClients.length,
    targets: targets.length,
    lastVisitMapSize: lastVisitMap.size,
    processed,
    updated,
    skippedNoAltegioId,
    skippedNoLastVisit,
    skippedExists,
    skippedNoChange,
    errors,
    ms,
  });

  return NextResponse.json({
    ok: true,
    stats: {
      totalClients: allClients.length,
      targets: targets.length,
      lastVisitMapSize: lastVisitMap.size,
      processed,
      updated,
      skippedNoAltegioId,
      skippedNoLastVisit,
      skippedExists,
      skippedNoChange,
      errors,
      ms,
      onlyMissing,
      dryRun,
    },
    samples,
    errorDetails: errorDetails.slice(0, 30),
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}

