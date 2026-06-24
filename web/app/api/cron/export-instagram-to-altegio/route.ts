// web/app/api/cron/export-instagram-to-altegio/route.ts
// Щоденний cron: експорт Instagram username з Direct (Prisma) в Altegio custom field instagram-user-name.

import { NextRequest, NextResponse } from 'next/server';
import { runExportInstagramToAltegioBatch } from '@/lib/direct/export-instagram-to-altegio-run';
import { kvWrite } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASS = process.env.ADMIN_PASS || '';

function okCron(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

async function runDailyExport(req: NextRequest) {
  const startedAt = Date.now();
  const cronMaxMs = 280_000;
  const delayMs = Math.max(0, Math.min(2000, Number(req.nextUrl.searchParams.get('delayMs') || '200') || 200));
  const batchLimit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get('limit') || '80') || 80));
  const maxBatches = Math.max(1, Math.min(30, Number(req.nextUrl.searchParams.get('maxBatches') || '15') || 15));

  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const via = isVercelCron ? 'vercel' : ADMIN_PASS && req.cookies.get('admin_token')?.value ? 'admin' : 'secret';

  try {
    await kvWrite.setRaw(
      'direct:cron:export-instagram-to-altegio:lastRun',
      JSON.stringify({
        phase: 'start',
        via,
        startedAt: new Date().toISOString(),
        delayMs,
        batchLimit,
        maxBatches,
      }),
    );
  } catch {
    // KV необов'язковий
  }

  console.log('[cron/export-instagram-to-altegio] Старт щоденного експорту IG → Altegio', {
    via,
    delayMs,
    batchLimit,
    maxBatches,
  });

  const aggregated = {
    batches: 0,
    totalTargets: 0,
    processed: 0,
    updated: 0,
    skippedNoPhone: 0,
    skippedNoIgNormalized: 0,
    fetchedNotFound: 0,
    errors: 0,
    ms: 0,
  };

  let offset = 0;
  let remaining = 1;
  let lastError: string | null = null;

  while (
    remaining > 0 &&
    aggregated.batches < maxBatches &&
    Date.now() - startedAt < cronMaxMs
  ) {
    const batchMaxRunMs = Math.min(240_000, cronMaxMs - (Date.now() - startedAt) - 3000);
    if (batchMaxRunMs < 10_000) {
      console.log('[cron/export-instagram-to-altegio] ⏹️ Мало часу для наступного батчу');
      break;
    }

    const result = await runExportInstagramToAltegioBatch({
      offset,
      limit: batchLimit,
      delayMs,
      maxRunMs: batchMaxRunMs,
    });

    if (!result.ok) {
      lastError = result.error || 'Unknown error';
      console.error('[cron/export-instagram-to-altegio] ❌ Батч failed:', lastError);
      break;
    }

    const s = (result.stats || {}) as Record<string, number | boolean | null | undefined>;
    aggregated.batches += 1;
    if (aggregated.totalTargets === 0 && typeof s.targets === 'number') {
      aggregated.totalTargets = s.targets;
    }
    aggregated.processed += Number(s.processed ?? 0);
    aggregated.updated += Number(s.updated ?? 0);
    aggregated.skippedNoPhone += Number(s.skippedNoPhone ?? 0);
    aggregated.skippedNoIgNormalized += Number(s.skippedNoIgNormalized ?? 0);
    aggregated.fetchedNotFound += Number(s.fetchedNotFound ?? 0);
    aggregated.errors += Number(s.errors ?? 0);
    aggregated.ms += Number(s.ms ?? 0);

    remaining = Number(s.remainingCount ?? 0);
    const nextOffset = s.nextBatchOffset;
    if (remaining > 0) {
      offset =
        typeof nextOffset === 'number' && Number.isFinite(nextOffset)
          ? nextOffset
          : offset + Number(s.processed ?? 0);
    }

    console.log('[cron/export-instagram-to-altegio] Батч', {
      batch: aggregated.batches,
      offset,
      remaining,
      updatedInBatch: s.updated,
    });
  }

  const done = remaining <= 0 && !lastError;
  const totalMs = Date.now() - startedAt;
  const payload = {
    ok: !lastError,
    done,
    via,
    stats: {
      ...aggregated,
      remainingCount: remaining,
      totalMs,
      lastError,
    },
    timestamp: new Date().toISOString(),
  };

  console.log('[cron/export-instagram-to-altegio] ✅ Завершено', payload.stats);

  try {
    await kvWrite.setRaw(
      'direct:cron:export-instagram-to-altegio:lastRun',
      JSON.stringify({
        phase: done ? 'done' : lastError ? 'error' : 'partial',
        via,
        finishedAt: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch {
    // ignore
  }

  if (lastError) {
    return NextResponse.json({ ...payload, error: lastError }, { status: 500 });
  }

  return NextResponse.json(payload);
}

export async function GET(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  return runDailyExport(req);
}

export async function POST(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  return runDailyExport(req);
}
