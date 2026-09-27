// web/app/api/admin/direct/repair-paid-range-from-api/route.ts
// Масовий догон платних клієнтів за період (напр. з 2026-09-01):
// унікальні client_id з Altegio GET /records → import (якщо треба) →
// sync-consultation-for-client + sync-visit-history-from-api.
// Батчами (skip/limit), щоб вкластись у maxDuration.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listPaidAltegioClientsInRange } from '@/lib/altegio/paid-day-api-reconcile';
import { getTodayKyiv, getPreviousKyivDay } from '@/lib/direct-stats-config';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = (req.headers.get('x-forwarded-proto') || 'http').split(',')[0]?.trim() || 'http';
  if (host) return `${proto}://${host}`;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  const port = process.env.PORT || 3000;
  return `http://127.0.0.1:${port}`;
}

function authHeaders(req: NextRequest): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cookie = req.headers.get('cookie');
  if (cookie) headers.Cookie = cookie;
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;
  else if (CRON_SECRET) headers.Authorization = `Bearer ${CRON_SECRET}`;
  return headers;
}

async function callJson(
  req: NextRequest,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: any }> {
  const url = `${getBaseUrl(req)}${path}`;
  console.log('[repair-paid-range-from-api] Внутрішній виклик', { path, method: init?.method || 'GET' });
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(req), ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.ok !== false, status: res.status, body };
}

function digitsPhone(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D+/g, '');
}

export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * POST ?from=2026-09-01&to=2026-09-26&skip=0&limit=10&importMissing=1&syncHistory=1
 * За замовчуванням: from=2026-09-01, to=вчора (Kyiv).
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  try {
    const fromParam = req.nextUrl.searchParams.get('from') || '2026-09-01';
    const toParam = req.nextUrl.searchParams.get('to');
    const fromKyivDay = getTodayKyiv(fromParam);
    const toKyivDay = toParam ? getTodayKyiv(toParam) : getPreviousKyivDay();
    const importMissing = req.nextUrl.searchParams.get('importMissing') !== '0';
    const syncHistory = req.nextUrl.searchParams.get('syncHistory') !== '0';
    const linkByPhone = req.nextUrl.searchParams.get('linkByPhone') !== '0';
    const skipRaw = Number(req.nextUrl.searchParams.get('skip') || '0');
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '10');
    const skip = Number.isFinite(skipRaw) && skipRaw >= 0 ? Math.floor(skipRaw) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, Math.floor(limitRaw))) : 10;

    console.log('[repair-paid-range-from-api] Старт', {
      fromKyivDay,
      toKyivDay,
      skip,
      limit,
      importMissing,
      syncHistory,
      linkByPhone,
    });

    const listed = await listPaidAltegioClientsInRange({ fromKyivDay, toKyivDay });
    const total = listed.clients.length;
    const batch = listed.clients.slice(skip, skip + limit);
    const actions: Array<Record<string, unknown>> = [];

    for (const ref of batch) {
      const altegioId = ref.altegioClientId;
      let existing = await prisma.directClient.findFirst({
        where: { altegioClientId: altegioId },
        select: { id: true, altegioClientId: true },
      });

      // Прив’язка ліда по унікальному телефону
      if (!existing && linkByPhone && ref.clientPhone) {
        const phoneDigits = digitsPhone(ref.clientPhone);
        if (phoneDigits.length >= 9) {
          const tail = phoneDigits.slice(-9);
          const unlinked = await prisma.directClient.findMany({
            where: { altegioClientId: null, phone: { not: null } },
            select: { id: true, phone: true },
            take: 5000,
          });
          const matches = unlinked.filter((c) => {
            const p = digitsPhone(c.phone);
            return p.endsWith(tail) || phoneDigits.endsWith(p.slice(-9));
          });
          if (matches.length === 1) {
            await prisma.directClient.update({
              where: { id: matches[0]!.id },
              data: { altegioClientId: altegioId },
            });
            existing = { id: matches[0]!.id, altegioClientId: altegioId };
            actions.push({
              type: 'link_by_phone',
              altegioClientId: altegioId,
              directClientId: matches[0]!.id,
              name: ref.clientName,
              ok: true,
            });
            console.log('[repair-paid-range-from-api] Прив’язано по телефону', {
              altegioId,
              directClientId: matches[0]!.id,
            });
          }
        }
      }

      if (!existing) {
        if (!importMissing) {
          actions.push({
            type: 'skip_missing',
            altegioClientId: altegioId,
            name: ref.clientName,
            paidDays: ref.paidDays,
            reason: 'importMissing=0',
          });
          continue;
        }
        const loaded = await callJson(
          req,
          `/api/admin/direct/load-client-from-altegio?altegioClientId=${altegioId}`,
          { method: 'POST' }
        );
        actions.push({
          type: 'import_client',
          altegioClientId: altegioId,
          name: ref.clientName,
          paidDays: ref.paidDays,
          ok: loaded.ok,
          status: loaded.status,
          created: loaded.body?.stats?.created,
          error: loaded.ok ? undefined : loaded.body?.error || loaded.body,
        });
        if (!loaded.ok) continue;
      }

      const synced = await callJson(req, `/api/admin/direct/sync-consultation-for-client`, {
        method: 'POST',
        body: JSON.stringify({ altegioClientId: altegioId }),
      });
      actions.push({
        type: 'sync_client',
        altegioClientId: altegioId,
        name: ref.clientName,
        paidDays: ref.paidDays,
        ok: synced.ok,
        status: synced.status,
        paidService: synced.body?.result?.paidService,
        breakdown: synced.body?.result?.breakdown,
        error: synced.ok ? undefined : synced.body?.error || synced.body,
      });

      if (syncHistory) {
        const hist = await callJson(
          req,
          `/api/admin/direct/sync-visit-history-from-api?altegioClientId=${altegioId}&delayMs=100`,
          { method: 'POST' }
        );
        actions.push({
          type: 'sync_history',
          altegioClientId: altegioId,
          name: ref.clientName,
          ok: hist.ok,
          status: hist.status,
          stats: hist.body?.stats
            ? {
                updated: hist.body.stats.updated,
                paidUpdated: hist.body.stats.paidUpdated,
                consultationUpdated: hist.body.stats.consultationUpdated,
              }
            : undefined,
          error: hist.ok ? undefined : hist.body?.error || hist.body,
        });
      }

      await new Promise((r) => setTimeout(r, 120));
    }

    const processed = batch.length;
    const nextSkip = skip + processed;
    const remainingCount = Math.max(0, total - nextSkip);
    const ms = Date.now() - started;

    console.log('[repair-paid-range-from-api] Батч готовий', {
      fromKyivDay,
      toKyivDay,
      total,
      skip,
      processed,
      remainingCount,
      ms,
    });

    return NextResponse.json({
      ok: true,
      message: `Догон ${fromKyivDay}…${toKyivDay}: батч ${processed} з ${total} (skip=${skip}), залишилось ${remainingCount}`,
      fromKyivDay,
      toKyivDay,
      locationId: listed.locationId,
      stats: {
        total,
        skip,
        processed,
        batchSize: processed,
        nextBatchOffset: remainingCount > 0 ? nextSkip : skip,
        remainingCount,
        ms,
      },
      importMissing,
      syncHistory,
      linkByPhone,
      actions,
    });
  } catch (err) {
    console.error('[repair-paid-range-from-api] Помилка:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
