// web/app/api/cron/sync-last-visit/route.ts
// Cron: періодична синхронізація lastVisitAt з Altegio для оновлення колонки «Днів»
// onlyMissing=1 — оновлюємо тільки клієнтів без lastVisitAt
// Запускається раз на годину

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function okCron(req: NextRequest): boolean {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  try {
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : req.nextUrl.origin || 'http://localhost:3000';
    const secret = process.env.CRON_SECRET || '';
    const url = `${baseUrl}/api/admin/direct/sync-last-visit?onlyMissing=1&limit=500&delayMs=100${
      secret ? `&secret=${encodeURIComponent(secret)}` : ''
    }`;

    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn('[cron/sync-last-visit] Sync returned non-OK:', res.status, data);
      return NextResponse.json({ ok: false, status: res.status, data }, { status: 502 });
    }

    console.log('[cron/sync-last-visit] Done:', data?.stats);
    return NextResponse.json({ ok: true, sync: data });
  } catch (err) {
    console.error('[cron/sync-last-visit] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
