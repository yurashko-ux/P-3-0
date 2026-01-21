// web/app/api/admin/direct/debug-altegio-metrics/route.ts
// DEBUG endpoint: перевірка, що Altegio повертає phone/visits/spent для конкретного clientId
// НЕ логуємо PII (телефон/суми), тільки наявність/типи.

import { NextRequest, NextResponse } from 'next/server';
import { fetchAltegioClientMetrics } from '@/lib/altegio/metrics';
import { prisma } from '@/lib/prisma';
import { getClient } from '@/lib/altegio/clients';
import { altegioFetch } from '@/lib/altegio/client';

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

  const altegioClientIdRaw = req.nextUrl.searchParams.get('altegioClientId') || '';
  const clientId = (req.nextUrl.searchParams.get('clientId') || '').toString().trim();
  const instagramUsernameRaw = (req.nextUrl.searchParams.get('instagramUsername') || '').toString().trim();

  let directClient: { id: string; instagramUsername: string; altegioClientId: number | null; phone: string | null; visits: number | null; spent: number | null } | null =
    null;

  let altegioClientId = Number(altegioClientIdRaw);
  if (!altegioClientId || Number.isNaN(altegioClientId)) {
    // Підтягуємо altegioClientId з БД за clientId або instagramUsername
    try {
      const where =
        clientId
          ? { id: clientId }
          : instagramUsernameRaw
            ? { instagramUsername: instagramUsernameRaw.toLowerCase() }
            : null;
      if (!where) {
        return NextResponse.json(
          { ok: false, error: 'Provide altegioClientId OR (clientId / instagramUsername)' },
          { status: 400 }
        );
      }

      const dc = await prisma.directClient.findFirst({
        where,
        select: { id: true, instagramUsername: true, altegioClientId: true, phone: true, visits: true, spent: true },
      });

      if (!dc?.altegioClientId) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Direct client not found or has no altegioClientId',
            debug: { clientId: dc?.id || null, instagramUsername: dc?.instagramUsername || null },
          },
          { status: 404 }
        );
      }
      altegioClientId = dc.altegioClientId;
      directClient = dc;
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  } else {
    // Якщо передали altegioClientId напряму — спробуємо знайти відповідний Direct клієнт
    try {
      directClient = await prisma.directClient.findFirst({
        where: { altegioClientId },
        select: { id: true, instagramUsername: true, altegioClientId: true, phone: true, visits: true, spent: true },
      });
    } catch {}
  }

  const res = await fetchAltegioClientMetrics({ altegioClientId });
  if (res.ok === false) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  }

  // Діагностика last_visit_* (без PII): дивимось і getClient, і clients/search (щоб зрозуміти, чому lastVisitAt не оновився)
  let lastVisitDebug: any = null;
  try {
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (companyId && !Number.isNaN(companyId)) {
      const full = await getClient(companyId, altegioClientId);
      const rawGetClient =
        (full as any)?.last_visit_date ??
        (full as any)?.last_visit_datetime ??
        (full as any)?.lastVisitDate ??
        (full as any)?.lastVisitAt ??
        null;

      // Спрощений пошук у /clients/search: тільки кілька сторінок, щоб перевірити, чи клієнт взагалі попадає в “топ” за last_visit_date
      let foundOnPage: number | null = null;
      let rawSearch: any = null;
      for (let page = 1; page <= 10; page++) {
        const searchResponse = await altegioFetch<any>(`/company/${companyId}/clients/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page,
            page_size: 100,
            fields: ['id', 'last_visit_date', 'last_visit_datetime'],
            order_by: 'last_visit_date',
            order_by_direction: 'desc',
          }),
        });

        let items: any[] = [];
        if (Array.isArray(searchResponse)) items = searchResponse;
        else if (searchResponse?.data && Array.isArray(searchResponse.data)) items = searchResponse.data;
        else if (searchResponse?.clients && Array.isArray(searchResponse.clients)) items = searchResponse.clients;
        else if (searchResponse?.items && Array.isArray(searchResponse.items)) items = searchResponse.items;

        const hit = items.find((c: any) => Number(c?.id) === Number(altegioClientId));
        if (hit) {
          foundOnPage = page;
          rawSearch =
            hit?.last_visit_date ?? hit?.last_visit_datetime ?? hit?.lastVisitDate ?? hit?.lastVisitAt ?? null;
          break;
        }
        if (!items.length) break;
      }

      lastVisitDebug = {
        companyId,
        getClient: {
          hasKey: rawGetClient != null,
          type: rawGetClient == null ? null : typeof rawGetClient,
          preview: rawGetClient == null ? null : String(rawGetClient).slice(0, 60),
        },
        search: {
          foundOnPage,
          hasKey: rawSearch != null,
          type: rawSearch == null ? null : typeof rawSearch,
          preview: rawSearch == null ? null : String(rawSearch).slice(0, 60),
        },
      };
    } else {
      lastVisitDebug = { companyId: null, error: 'ALTEGIO_COMPANY_ID not configured' };
    }
  } catch (err) {
    lastVisitDebug = { error: err instanceof Error ? err.message : String(err) };
  }

  // #region agent log
  try {
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'web/app/api/admin/direct/debug-altegio-metrics/route.ts:lastVisitDebug',message:'Altegio last_visit_* debug (safe)',data:{altegioClientId:String(altegioClientId).slice(0,12),hasDebug:Boolean(lastVisitDebug)},timestamp:Date.now(),sessionId:'debug-session',runId:'days-2',hypothesisId:'H_sync_source_mismatch'})}).catch(()=>{});
  } catch {}
  // #endregion agent log

  const db = directClient
    ? {
        directClientId: directClient.id,
        instagramUsername: directClient.instagramUsername,
        altegioClientId: directClient.altegioClientId,
        phonePresent: Boolean(directClient.phone && directClient.phone.trim()),
        phoneLength: directClient.phone ? directClient.phone.length : 0,
        visits: directClient.visits ?? null,
        spent: directClient.spent ?? null,
      }
    : null;

  return NextResponse.json({
    ok: true,
    altegioClientId,
    db,
    parsed: {
      phonePresent: Boolean(res.metrics.phone),
      visitsPresent: res.metrics.visits !== null && res.metrics.visits !== undefined,
      spentPresent: res.metrics.spent !== null && res.metrics.spent !== undefined,
      visitsValue: res.metrics.visits ?? null,
      spentIsZero: (res.metrics.spent ?? null) === 0,
    },
    lastVisitDebug,
    compare: db
      ? {
          phoneEqual:
            Boolean(directClient?.phone && directClient.phone.trim()) && Boolean(res.metrics.phone)
              ? directClient!.phone!.trim() === res.metrics.phone
              : false,
          visitsEqual: (directClient?.visits ?? null) === (res.metrics.visits ?? null),
          spentEqual: (directClient?.spent ?? null) === (res.metrics.spent ?? null),
        }
      : null,
  });
}

