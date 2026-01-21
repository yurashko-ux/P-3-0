// web/app/api/admin/direct/sync-altegio-metrics-now/route.ts
// Ручний синк: phone/visits/spent з Altegio для Direct клієнтів з altegioClientId
// ВАЖЛИВО: не рухаємо updatedAt (технічний синк).

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';

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

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const limit = Math.max(0, Math.min(5000, Number(req.nextUrl.searchParams.get('limit') || '0') || 0));
  const delayMs = Math.max(0, Math.min(2000, Number(req.nextUrl.searchParams.get('delayMs') || '200') || 200));
  const onlyMissing = (req.nextUrl.searchParams.get('onlyMissing') || '0') === '1';
  const dryRun = (req.nextUrl.searchParams.get('dryRun') || '0') === '1';
  const instagramUsername = (req.nextUrl.searchParams.get('instagramUsername') || '').toString().trim().toLowerCase();

  console.log('[admin/sync-altegio-metrics-now] Старт', { limit, delayMs, onlyMissing, dryRun, instagramUsername });

  const allClients = await getAllDirectClients();
  let targets = allClients.filter((c) => typeof c.altegioClientId === 'number' && (c.altegioClientId || 0) > 0);
  if (instagramUsername) {
    targets = targets.filter((c) => (c.instagramUsername || '').toString().trim().toLowerCase() === instagramUsername);
  }

  let processed = 0;
  let updated = 0;
  let skippedNoAltegioId = allClients.length - targets.length;
  let skippedNoChange = 0;
  let fetchedNotFound = 0;
  let skippedOnlyMissing = 0;
  let errors = 0;

  const samples: Array<{ directClientId: string; altegioClientId: number; action: string; changedKeys?: string[] }> = [];
  const errorDetails: Array<{ directClientId: string; altegioClientId: number; error: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const client = targets[i];
    if (!client.altegioClientId) continue;
    if (limit && processed >= limit) break;
    processed++;

    try {
      if (onlyMissing) {
        const hasAny = Boolean(client.phone) || typeof client.visits === 'number' || typeof client.spent === 'number';
        if (hasAny) {
          skippedOnlyMissing++;
          continue;
        }
      }

      const res = await fetchAltegioClientMetrics({ altegioClientId: client.altegioClientId });
      if (res.ok === false) {
        const errText = res.error || 'unknown_error';
        if (errText.toLowerCase().includes('not found')) {
          fetchedNotFound++;
          continue;
        }
        throw new Error(errText);
      }

      const nextPhone = res.metrics.phone ? res.metrics.phone : null;
      const nextVisits = res.metrics.visits ?? null;
      const nextSpent = res.metrics.spent ?? null;

      const updates: any = {};
      const changedKeys: string[] = [];

      if (nextPhone && (!client.phone || client.phone.trim() !== nextPhone)) {
        updates.phone = nextPhone;
        changedKeys.push('phone');
      }
      if (nextVisits !== null && client.visits !== nextVisits) {
        updates.visits = nextVisits;
        changedKeys.push('visits');
      }
      if (nextSpent !== null && client.spent !== nextSpent) {
        updates.spent = nextSpent;
        changedKeys.push('spent');
      }

      if (changedKeys.length === 0) {
        skippedNoChange++;
        continue;
      }

      if (dryRun) {
        if (samples.length < 20) {
          samples.push({ directClientId: client.id, altegioClientId: client.altegioClientId, action: 'dry_run', changedKeys });
        }
        continue;
      }

      const updatedClient = {
        ...client,
        ...updates,
        updatedAt: client.updatedAt, // НЕ рухаємо updatedAt
      };

      await saveDirectClient(
        updatedClient,
        'admin-sync-altegio-metrics-now',
        { altegioClientId: client.altegioClientId, changedKeys },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );

      updated++;
      if (samples.length < 20) {
        samples.push({ directClientId: client.id, altegioClientId: client.altegioClientId, action: 'saved', changedKeys });
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ directClientId: client.id, altegioClientId: client.altegioClientId, error: msg });
      console.error('[admin/sync-altegio-metrics-now] ❌ Помилка', { directClientId: client.id, altegioClientId: client.altegioClientId, error: msg });
    } finally {
      if (delayMs && i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const ms = Date.now() - startedAt;
  return NextResponse.json({
    ok: true,
    stats: {
      totalClients: allClients.length,
      targets: targets.length,
      processed,
      updated,
      skippedNoAltegioId,
      skippedNoChange,
      skippedOnlyMissing,
      fetchedNotFound,
      errors,
      ms,
      onlyMissing,
      dryRun,
      instagramUsername: instagramUsername || null,
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

