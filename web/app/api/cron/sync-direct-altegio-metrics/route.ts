// web/app/api/cron/sync-direct-altegio-metrics/route.ts
// Щоденний cron: синхронізація phone/visits/spent з Altegio API для всіх Direct клієнтів з altegioClientId

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function okCron(req: NextRequest) {
  // 1) Дозволяємо офіційний крон Vercel
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  // 2) Або запит з локальним секретом (на випадок ручного виклику)
  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

async function runSync(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const startedAt = Date.now();
  const delayMs = Math.max(0, Math.min(2000, Number(req.nextUrl.searchParams.get('delayMs') || '200') || 200));
  const limit = Math.max(0, Math.min(5000, Number(req.nextUrl.searchParams.get('limit') || '0') || 0));

  console.log('[cron/sync-direct-altegio-metrics] Старт', { delayMs, limit });

  const allClients = await getAllDirectClients();
  const targets = allClients.filter((c) => typeof c.altegioClientId === 'number' && (c.altegioClientId || 0) > 0);

  let processed = 0;
  let updated = 0;
  let skippedNoAltegioId = allClients.length - targets.length;
  let skippedNoChange = 0;
  let fetchedNotFound = 0;
  let errors = 0;

  const samples: Array<{ directClientId: string; altegioClientId: number; action: string; changedKeys?: string[] }> = [];
  const errorDetails: Array<{ directClientId: string; altegioClientId: number; error: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const client = targets[i];
    if (!client.altegioClientId) continue;
    if (limit && processed >= limit) break;
    processed++;

    try {
      const res = await fetchAltegioClientMetrics({ altegioClientId: client.altegioClientId });
      if (!res.ok) {
        if (res.error.toLowerCase().includes('not found')) {
          fetchedNotFound++;
          continue;
        }
        throw new Error(res.error);
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

      const updatedClient = {
        ...client,
        ...updates,
        // НЕ рухаємо updatedAt (це технічний синк)
        updatedAt: client.updatedAt,
      };

      await saveDirectClient(
        updatedClient,
        'cron-sync-direct-altegio-metrics',
        { altegioClientId: client.altegioClientId, changedKeys },
        { touchUpdatedAt: false, skipAltegioMetricsSync: true }
      );

      updated++;
      if (samples.length < 20) {
        samples.push({
          directClientId: client.id,
          altegioClientId: client.altegioClientId,
          action: 'saved',
          changedKeys,
        });
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ directClientId: client.id, altegioClientId: client.altegioClientId, error: msg });
      console.error('[cron/sync-direct-altegio-metrics] ❌ Помилка', {
        directClientId: client.id,
        altegioClientId: client.altegioClientId,
        error: msg,
      });
    } finally {
      if (delayMs && i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const ms = Date.now() - startedAt;
  console.log('[cron/sync-direct-altegio-metrics] ✅ Готово', {
    totalClients: allClients.length,
    targets: targets.length,
    processed,
    updated,
    skippedNoAltegioId,
    skippedNoChange,
    fetchedNotFound,
    errors,
    ms,
  });

  return NextResponse.json({
    ok: true,
    stats: {
      totalClients: allClients.length,
      targets: targets.length,
      processed,
      updated,
      skippedNoAltegioId,
      skippedNoChange,
      fetchedNotFound,
      errors,
      ms,
    },
    samples,
    errorDetails: errorDetails.slice(0, 30),
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return runSync(req);
}

export async function POST(req: NextRequest) {
  return runSync(req);
}

