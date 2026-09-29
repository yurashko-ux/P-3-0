// web/app/api/admin/direct/repair-paid-day-from-api/route.ts
// Догон платних записів за день з Altegio API:
// - incomplete → sync-consultation-for-client
// - missing_client → load-client-from-altegio + sync
// - unlinked_lead з унікальним phone-кандидатом → прив’язка altegioClientId + sync
// Ім’я-матч без телефону — лише в звіті, без автоприв’язки.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reconcilePaidDayFromAltegioApi } from '@/lib/altegio/paid-day-api-reconcile';
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
  console.log('[repair-paid-day-from-api] Внутрішній виклик', { path, method: init?.method || 'GET' });
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(req), ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.ok !== false, status: res.status, body };
}

export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * POST ?day=YYYY-MM-DD&importMissing=1&linkByPhone=1&limit=20
 * За замовчуванням: вчора Kyiv; importMissing=1; linkByPhone=1.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dayParam = req.nextUrl.searchParams.get('day');
    const kyivDay = dayParam ? getTodayKyiv(dayParam) : getPreviousKyivDay();
    const importMissing = req.nextUrl.searchParams.get('importMissing') !== '0';
    const linkByPhone = req.nextUrl.searchParams.get('linkByPhone') !== '0';
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '30');
    const limit = Number.isFinite(limitRaw) ? Math.min(80, Math.max(1, limitRaw)) : 30;

    console.log('[repair-paid-day-from-api] Старт догону', {
      kyivDay,
      importMissing,
      linkByPhone,
      limit,
    });

    const before = await reconcilePaidDayFromAltegioApi({ kyivDay });
    const actions: Array<Record<string, unknown>> = [];
    let processed = 0;

    for (const row of before.rows) {
      if (processed >= limit) break;
      if (row.kind === 'ok' || row.kind === 'no_altegio_client_id') continue;

      const altegioId = row.altegio.altegioClientId;
      if (!altegioId) continue;

      // 1) Прив’язка ліда по унікальному телефону
      if (row.kind === 'unlinked_lead' && linkByPhone) {
        const phoneCand = (row.linkCandidates || []).filter((c) => c.matchBy === 'phone');
        if (phoneCand.length === 1) {
          const cand = phoneCand[0]!;
          try {
            await prisma.directClient.update({
              where: { id: cand.id },
              data: { altegioClientId: altegioId },
            });
            actions.push({
              type: 'link_by_phone',
              altegioClientId: altegioId,
              directClientId: cand.id,
              name: row.altegio.clientName,
              ok: true,
            });
            console.log('[repair-paid-day-from-api] Прив’язано по телефону', {
              altegioId,
              directClientId: cand.id,
            });
          } catch (err) {
            actions.push({
              type: 'link_by_phone',
              altegioClientId: altegioId,
              directClientId: cand.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
            processed++;
            continue;
          }
        } else {
          actions.push({
            type: 'skip_unlinked',
            altegioClientId: altegioId,
            name: row.altegio.clientName,
            reason:
              phoneCand.length === 0
                ? 'немає унікального phone-кандидата (ім’я не автоприв’язуємо)'
                : `кілька phone-кандидатів: ${phoneCand.length}`,
          });
          // Без лінку далі не sync
          processed++;
          continue;
        }
      }

      // 2) Імпорт відсутнього клієнта
      if (row.kind === 'missing_client') {
        if (!importMissing) {
          actions.push({
            type: 'skip_missing',
            altegioClientId: altegioId,
            name: row.altegio.clientName,
            reason: 'importMissing=0',
          });
          processed++;
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
          name: row.altegio.clientName,
          ok: loaded.ok,
          status: loaded.status,
          created: loaded.body?.stats?.created,
          updated: loaded.body?.stats?.updated,
          error: loaded.ok ? undefined : loaded.body?.error || loaded.body,
        });
        if (!loaded.ok) {
          processed++;
          continue;
        }
      }

      // 3) Повна синхронізація запису/суми/attendance (incomplete + після import/link)
      if (
        row.kind === 'incomplete' ||
        row.kind === 'missing_client' ||
        row.kind === 'unlinked_lead'
      ) {
        const synced = await callJson(req, `/api/admin/direct/sync-consultation-for-client`, {
          method: 'POST',
          body: JSON.stringify({ altegioClientId: altegioId }),
        });
        actions.push({
          type: 'sync_client',
          altegioClientId: altegioId,
          name: row.altegio.clientName,
          ok: synced.ok,
          status: synced.status,
          result: synced.body?.result
            ? {
                paidService: synced.body.result.paidService,
                breakdown: synced.body.result.breakdown,
              }
            : undefined,
          error: synced.ok ? undefined : synced.body?.error || synced.body,
        });
      }

      processed++;
      // Невелика пауза між клієнтами (ліміти Altegio)
      await new Promise((r) => setTimeout(r, 150));
    }

    const after = await reconcilePaidDayFromAltegioApi({ kyivDay });

    console.log('[repair-paid-day-from-api] Готово', {
      kyivDay,
      processed,
      actions: actions.length,
      beforeCounts: before.counts,
      afterCounts: after.counts,
    });

    return NextResponse.json({
      ok: true,
      message: `Догон ${kyivDay}: оброблено ${processed}, було прогалин ${
        before.rows.filter((r) => r.kind !== 'ok').length
      }, стало ${after.rows.filter((r) => r.kind !== 'ok').length}`,
      kyivDay,
      processed,
      limit,
      importMissing,
      linkByPhone,
      before: {
        altegioPaidClients: before.altegioPaidClients,
        directWithPaidDate: before.directWithPaidDate,
        counts: before.counts,
      },
      after: {
        altegioPaidClients: after.altegioPaidClients,
        directWithPaidDate: after.directWithPaidDate,
        counts: after.counts,
      },
      actions,
      remainingGaps: after.rows.filter((r) => r.kind !== 'ok'),
    });
  } catch (err) {
    console.error('[repair-paid-day-from-api] Помилка:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
