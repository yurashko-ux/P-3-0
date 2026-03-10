// web/app/api/admin/direct/import-altegio-full/route.ts
// Повний імпорт клієнтів з Altegio: fetch → filter existing → GET details + visits → save Prisma + KV

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saveDirectClient } from '@/lib/direct-store';
import { altegioFetch } from '@/lib/altegio/client';
import { getEnvValue } from '@/lib/env';
import { normalizeInstagram } from '@/lib/normalize';
import { getClientRecordsRaw, rawRecordToRecordEvent } from '@/lib/altegio/records';
import { determineStateFromServices } from '@/lib/direct-state-helper';
import { kvRead, kvWrite } from '@/lib/kv';
import { AltegioHttpError } from '@/lib/altegio/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Макс. клієнтів за один запит — щоб не перевищити FUNCTION_INVOCATION_TIMEOUT (Vercel ~5 хв, Hobby ~60 с) */
const MAX_IMPORT_PER_REQUEST = 40;

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

function extractInstagramFromAltegioClient(client: any): string | null {
  const instagramFields: (string | null)[] = [
    client['instagram-user-name'],
    client.instagram_user_name,
    client.instagramUsername,
    client.instagram_username,
    client.instagram,
  ];

  if (Array.isArray(client.custom_fields)) {
    for (const field of client.custom_fields) {
      if (field && typeof field === 'object') {
        const title = field.title || field.name || field.label || '';
        const value = field.value || field.data || field.content || field.text || '';
        if (value && typeof value === 'string' && /instagram/i.test(title)) {
          instagramFields.push(value);
        }
      }
    }
  }

  if (client.custom_fields && typeof client.custom_fields === 'object' && !Array.isArray(client.custom_fields)) {
    instagramFields.push(
      client.custom_fields['instagram-user-name'],
      client.custom_fields.instagram_user_name,
      client.custom_fields.instagramUsername
    );
  }

  for (const field of instagramFields) {
    if (field && typeof field === 'string' && field.trim()) {
      const normalized = normalizeInstagram(field.trim());
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractNameFromAltegioClient(client: any): { firstName?: string; lastName?: string } {
  if (!client.name) return {};
  const nameParts = client.name.trim().split(/\s+/);
  if (nameParts.length === 0) return {};
  if (nameParts.length === 1) return { firstName: nameParts[0] };
  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  };
}

/**
 * GET - перевірити скільки клієнтів залишилось імпортувати (без імпорту).
 * Показує: з Altegio, вже в Direct, залишилось імпортувати.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
    if (!companyIdStr) {
      return NextResponse.json(
        { ok: false, error: 'ALTEGIO_COMPANY_ID не налаштовано' },
        { status: 400 }
      );
    }
    const companyId = parseInt(companyIdStr, 10);
    if (isNaN(companyId)) {
      return NextResponse.json(
        { ok: false, error: 'Невірний ALTEGIO_COMPANY_ID' },
        { status: 400 }
      );
    }

    let clientsFromAltegio: any[] = [];
    let page = 1;
    const pageSize = 100;

    do {
      const searchResponse = await altegioFetch<any>(
        `/company/${companyId}/clients/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page,
            page_size: pageSize,
            fields: ['id'],
            order_by: 'last_visit_date',
            order_by_direction: 'desc',
          }),
        }
      );

      let pageClients: any[] = [];
      if (Array.isArray(searchResponse)) {
        pageClients = searchResponse;
      } else if (searchResponse && typeof searchResponse === 'object') {
        pageClients =
          searchResponse.data ?? searchResponse.clients ?? searchResponse.items ?? [];
      }

      clientsFromAltegio.push(...pageClients);
      if (pageClients.length === 0) break;

      const meta = searchResponse && typeof searchResponse === 'object' && 'meta' in searchResponse ? searchResponse.meta : null;
      if (meta && meta.last_page != null && page >= meta.last_page) break;
      if (pageClients.length < pageSize) break;

      page++;
      await new Promise((r) => setTimeout(r, 150));
    } while (true);

    const existingAltegioIds = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      select: { altegioClientId: true },
    });
    const existingSet = new Set(
      existingAltegioIds.map((r) => r.altegioClientId).filter((id): id is number => id != null)
    );

    const toImportAll = clientsFromAltegio.filter(
      (c) => c.id != null && !existingSet.has(Number(c.id))
    );

    return NextResponse.json({
      ok: true,
      fetchedFromAltegio: clientsFromAltegio.length,
      alreadyInDirect: clientsFromAltegio.length - toImportAll.length,
      toImportCount: toImportAll.length,
      message: toImportAll.length > 0
        ? `Залишилось імпортувати: ${toImportAll.length} клієнтів. Запустіть «Імпорт всієї бази з Altegio».`
        : 'Усі клієнти з Altegio вже в Direct.',
    });
  } catch (error) {
    console.error('[import-altegio-full] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST - імпорт клієнтів з Altegio
 * Body: { max_clients?: number; all?: boolean }
 * - all: true — імпорт всієї бази (пагінація по всіх сторінках)
 * - max_clients: N — обмеження (1–10000)
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const importAll = body.all === true;
    const maxClients = importAll
      ? 10000
      : typeof body.max_clients === 'number'
        ? Math.min(10000, Math.max(1, body.max_clients))
        : 100;

    const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
    if (!companyIdStr) {
      return NextResponse.json(
        { ok: false, error: 'ALTEGIO_COMPANY_ID не налаштовано' },
        { status: 400 }
      );
    }
    const companyId = parseInt(companyIdStr, 10);
    if (isNaN(companyId)) {
      return NextResponse.json(
        { ok: false, error: 'Невірний ALTEGIO_COMPANY_ID' },
        { status: 400 }
      );
    }

    const pageSize = 100;
    console.log(`[import-altegio-full] Старт імпорту, all=${importAll}, max_clients=${maxClients}`);

    // Етап 1: отримати клієнтів з Altegio (з пагінацією для повного імпорту)
    let clientsFromAltegio: any[] = [];
    let page = 1;
    let totalFetched = 0;

    do {
      const searchResponse = await altegioFetch<any>(
        `/company/${companyId}/clients/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page,
            page_size: pageSize,
            fields: ['id', 'name', 'phone', 'email', 'visits', 'spent', 'last_visit_date', 'last_change_date'],
            order_by: 'last_visit_date',
            order_by_direction: 'desc',
          }),
        }
      );

      let pageClients: any[] = [];
      if (Array.isArray(searchResponse)) {
        pageClients = searchResponse;
      } else if (searchResponse && typeof searchResponse === 'object') {
        pageClients =
          searchResponse.data ?? searchResponse.clients ?? searchResponse.items ?? [];
      }

      clientsFromAltegio.push(...pageClients);
      totalFetched += pageClients.length;

      if (pageClients.length === 0) break;

      const meta = searchResponse && typeof searchResponse === 'object' && 'meta' in searchResponse ? searchResponse.meta : null;
      if (meta && meta.last_page != null && page >= meta.last_page) break;
      if (pageClients.length < pageSize) break;
      if (!importAll && totalFetched >= maxClients) break;

      page++;
      await new Promise((r) => setTimeout(r, 200));
    } while (importAll || totalFetched < maxClients);

    // Обрізаємо до max_clients якщо не повний імпорт
    if (!importAll && clientsFromAltegio.length > maxClients) {
      clientsFromAltegio = clientsFromAltegio.slice(0, maxClients);
    }

    if (clientsFromAltegio.length === 0) {
      return NextResponse.json({
        ok: true,
        stats: {
          fetchedFromAltegio: 0,
          alreadyInDirect: 0,
          newToImport: 0,
          imported: 0,
          visitRecordsPushedToKV: 0,
        },
        message: 'Клієнтів з Altegio не знайдено',
      });
    }

    // Етап 2: відфільтрувати вже існуючих
    const existingAltegioIds = await prisma.directClient.findMany({
      where: { altegioClientId: { not: null } },
      select: { altegioClientId: true },
    });
    const existingSet = new Set(
      existingAltegioIds.map((r) => r.altegioClientId).filter((id): id is number => id != null)
    );

    const toImportAll = clientsFromAltegio.filter(
      (c) => c.id != null && !existingSet.has(Number(c.id))
    );
    // Обмежуємо кількість за один запит — інакше FUNCTION_INVOCATION_TIMEOUT
    const toImport = toImportAll.slice(0, MAX_IMPORT_PER_REQUEST);
    const remainingToImport = Math.max(0, toImportAll.length - MAX_IMPORT_PER_REQUEST);

    const stats = {
      fetchedFromAltegio: clientsFromAltegio.length,
      alreadyInDirect: clientsFromAltegio.length - toImportAll.length,
      newToImport: toImport.length,
      remainingToImport, // Скільки ще залишилось — запустіть імпорт знову
      imported: 0,
      visitRecordsPushedToKV: 0,
      skipped404: 0, // Клієнти з 404 (видалені або недоступні в Altegio)
      errors: [] as string[],
    };

    const importedClientIds: string[] = [];
    const importedAltegioIds: number[] = [];

    for (const altegioClient of toImport) {
      const altegioId = Number(altegioClient.id);
      if (!Number.isFinite(altegioId)) continue;

      try {
        // GET повний профіль клієнта (custom_fields для Instagram)
        // При 404 — fallback на дані з search (name, phone, visits, spent, last_visit_date)
        let clientData: any = null;
        try {
          const fullClient = await altegioFetch<any>(
            `/company/${companyId}/clients/${altegioId}`,
            { method: 'GET' }
          );
          clientData = fullClient?.data ?? fullClient;
        } catch (fetchErr) {
          const is404 = fetchErr instanceof AltegioHttpError ? fetchErr.status === 404 : /404/.test(String(fetchErr));
          if (is404) {
            // Fallback: використовуємо дані з search (як sync-altegio-bulk)
            clientData = altegioClient;
            if (stats.imported < 5) {
              console.log(`[import-altegio-full] Fallback на search data для клієнта ${altegioId} (GET 404)`);
            }
          } else {
            throw fetchErr;
          }
        }

        let instagramUsername = extractInstagramFromAltegioClient(clientData ?? altegioClient);
        if (!instagramUsername) {
          const { firstName, lastName } = extractNameFromAltegioClient(altegioClient);
          const nameSlug = (firstName || lastName || 'client')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 10);
          instagramUsername = `altegio_${nameSlug}_${altegioId}`;
        }

        instagramUsername = normalizeInstagram(instagramUsername) || instagramUsername;

        // Історія візитів — GET /records
        const rawRecords = await getClientRecordsRaw(companyId, altegioId);

        // Записати record-events в KV
        for (const rec of rawRecords) {
          if (rec?.deleted) continue;
          const event = rawRecordToRecordEvent(rec, altegioId, companyId);
          if (event.clientId) {
            await kvWrite.lpush('altegio:records:log', JSON.stringify(event));
            stats.visitRecordsPushedToKV++;
          }
        }
        await kvWrite.ltrim('altegio:records:log', 0, 9999);

        // Визначити стан з останнього запису
        const lastRecord = rawRecords.filter((r) => !r?.deleted)[0];
        const servicesForState = lastRecord?.services ?? lastRecord?.data?.services ?? [];
        const stateFromServices = determineStateFromServices(Array.isArray(servicesForState) ? servicesForState : []);
        const determinedState: 'consultation' | 'hair-extension' | 'other-services' | 'client' =
          stateFromServices ?? 'client';

        const { firstName, lastName } = extractNameFromAltegioClient(clientData ?? altegioClient);
        const phone = (clientData?.phone ?? altegioClient?.phone ?? '').toString().trim();
        const visits = Number(clientData?.visits ?? altegioClient?.visits) || null;
        const spent = Number(clientData?.spent ?? altegioClient?.spent) || null;

        let lastVisitAt: string | undefined;
        const lv = clientData?.last_visit_date ?? altegioClient?.last_visit_date ?? lastRecord?.date ?? lastRecord?.datetime;
        if (lv) {
          const d = new Date(lv);
          if (!isNaN(d.getTime())) lastVisitAt = d.toISOString();
        }

        let serviceMasterName: string | undefined;
        const staff = lastRecord?.staff ?? lastRecord?.data?.staff;
        if (staff?.name) serviceMasterName = String(staff.name);

        const now = new Date().toISOString();
        const newClient = {
          id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          instagramUsername,
          firstName,
          lastName,
          ...(phone ? { phone } : {}),
          source: 'instagram' as const,
          state: determinedState as 'client' | 'consultation' | 'hair-extension' | 'other-services',
          firstContactDate: now,
          statusId: 'new',
          visitedSalon: false,
          signedUpForPaidService: false,
          altegioClientId: altegioId,
          createdAt: now,
          updatedAt: now,
          ...(visits != null ? { visits } : {}),
          ...(spent != null ? { spent } : {}),
          ...(lastVisitAt ? { lastVisitAt } : {}),
          ...(serviceMasterName ? { serviceMasterName } : {}),
        };

        await saveDirectClient(
          newClient,
          'import-altegio-full',
          { altegioClientId: altegioId },
          { touchUpdatedAt: false, skipAltegioMetricsSync: true }
        );

        stats.imported++;
        importedClientIds.push(newClient.id);
        importedAltegioIds.push(altegioId);

        // Затримка для rate limit
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push(`Altegio ${altegioId}: ${msg}`);
        console.warn(`[import-altegio-full] Помилка для клієнта ${altegioId}:`, err);
      }
    }

    console.log(`[import-altegio-full] Завершено:`, stats);

    // Sync visit history та backfill breakdown (узгоджено з load-client-from-altegio)
    const getBaseUrl = () => {
      const vercel = process.env.VERCEL_URL?.trim();
      if (vercel) return `https://${vercel}`;
      return `http://127.0.0.1:${process.env.PORT || 3000}`;
    };
    const baseUrl = getBaseUrl();
    const authParam = CRON_SECRET ? `&secret=${encodeURIComponent(CRON_SECRET)}` : '';
    let syncVisitStats: { updated?: number; errors?: number } | null = null;
    let backfillStats: { updated?: number; reason?: string } | null = null;

    if (importedAltegioIds.length > 0) {
      const idsParam = `altegioClientIds=${importedAltegioIds.join(',')}`;
      const statusParam = `statusId=new`;
      try {
        const syncRes = await fetch(
          `${baseUrl}/api/admin/direct/sync-visit-history-from-api?${idsParam}&${statusParam}&delayMs=150${authParam}`,
          { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }
        );
        const syncData = await syncRes.json();
        if (syncData?.stats) {
          syncVisitStats = {
            updated: syncData.stats.updated ?? 0,
            errors: syncData.stats.errors ?? 0,
          };
        }
      } catch (syncErr) {
        console.warn('[import-altegio-full] sync-visit-history failed:', syncErr);
        syncVisitStats = { errors: 1 };
      }

      try {
        const breakdownRes = await fetch(
          `${baseUrl}/api/admin/direct/backfill-visit-breakdown?${idsParam}&${statusParam}${authParam}`,
          { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }
        );
        const breakdownData = await breakdownRes.json();
        if (breakdownData?.updated != null || breakdownData?.reason) {
          backfillStats = {
            updated: breakdownData.updated,
            reason: breakdownData.reason,
          };
        }
      } catch (breakdownErr) {
        console.warn('[import-altegio-full] backfill-visit-breakdown failed:', breakdownErr);
      }
    }

    const msgParts = [
      `${stats.imported} нових клієнтів імпортовано`,
      `${stats.visitRecordsPushedToKV} записів додано в історію`,
    ];
    if (syncVisitStats) {
      msgParts.push(`Sync visit: ${syncVisitStats.updated ?? 0} оновлено`);
    }
    if (stats.remainingToImport > 0) {
      msgParts.push(`Залишилось ${stats.remainingToImport} — запустіть імпорт ще раз`);
    }
    if (stats.skipped404 > 0) {
      msgParts.push(`${stats.skipped404} пропущено (404 — видалені або недоступні в Altegio)`);
    }
    if (stats.errors.length > 0) {
      msgParts.push(`${stats.errors.length} помилок`);
    }

    return NextResponse.json({
      ok: true,
      stats: {
        ...stats,
        importedClientIds,
        syncVisitHistory: syncVisitStats,
        backfillBreakdown: backfillStats,
      },
      message: msgParts.join(', '),
    });
  } catch (error) {
    console.error('[import-altegio-full] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
