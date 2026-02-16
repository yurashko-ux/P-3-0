// web/app/api/admin/direct/sync-spent-visits/route.ts
// Синхронізація spent та visits з Altegio API для всіх клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';

const DEBUG_LOG = join(process.cwd(), '..', '.cursor', 'debug.log');
const DEBUG_LOG_ALT = join(process.cwd(), 'debug-visits.log');
function debugLog(msg: string, data: Record<string, unknown>, hypothesisId: string) {
  const line = JSON.stringify({ ...data, message: msg, hypothesisId, timestamp: Date.now() }) + '\n';
  try { appendFileSync(DEBUG_LOG, line); } catch {
    try { appendFileSync(DEBUG_LOG_ALT, line); } catch {}
  }
}
import { getAllDirectClients } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { saveDirectClient } from '@/lib/direct-store';
import { assertAltegioEnv } from '@/lib/altegio/env';

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

export async function POST(req: NextRequest) {
  try {
    // #region agent log
    debugLog('POST received', { method: 'POST', hasAuth: !!req.cookies.get('admin_token')?.value }, 'E');
    // #endregion
    // Перевірка авторизації
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // #region agent log
    debugLog('Sync started (auth passed)', { location: 'sync-spent-visits:32' }, 'E');
    // #endregion

    // Важливо: для отримання spent/visits ми використовуємо location_id (companyId) з ALTEGIO_COMPANY_ID,
    // так само як у тестовому endpoint /api/altegio/test/clients/[clientId]
    assertAltegioEnv();
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
    const companyId = parseInt(companyIdStr, 10);
    if (!companyId || isNaN(companyId)) {
      return NextResponse.json({
        ok: false,
        error: 'ALTEGIO_COMPANY_ID not configured',
      }, { status: 500 });
    }

    console.log(`[direct/sync-spent-visits] Starting sync for company ${companyId} (from ALTEGIO_COMPANY_ID='${companyIdStr}')...`);

    // Отримуємо всіх клієнтів з бази даних
    const allClients = await getAllDirectClients();
    console.log(`[direct/sync-spent-visits] Found ${allClients.length} clients in database`);

    // Фільтруємо клієнтів з altegioClientId
    const clientsWithAltegioId = allClients.filter(c => c.altegioClientId);

    // #region agent log
    debugLog('Clients to sync', { location: 'sync-spent-visits:56', total: allClients.length, withAltegioId: clientsWithAltegioId.length }, 'E');
    // #endregion

    console.log(`[direct/sync-spent-visits] Found ${clientsWithAltegioId.length} clients with Altegio ID`);
    console.log(`[direct/sync-spent-visits] Using individual requests with rate limiting (4 req/sec)`);
    console.log(`[direct/sync-spent-visits] Estimated time: ~${Math.ceil(clientsWithAltegioId.length / 4)} seconds`);

    const requestsPerSecond = 4; // 4 запити/сек для дотримання rate limit (5/сек)
    const delayBetweenRequests = 1000 / requestsPerSecond; // 250мс між запитами

    let updatedCount = 0;
    let skippedCount = 0;
    let skippedNoAltegioId = allClients.length - clientsWithAltegioId.length;
    let skippedNotFound = 0;
    let skippedNoUpdate = 0;
    const errors: string[] = [];
    const details: any[] = [];

    // Обробляємо клієнтів по одному з дотриманням rate limit
    for (let i = 0; i < clientsWithAltegioId.length; i++) {
      const client = clientsWithAltegioId[i];
      
      try {
        if (!client.altegioClientId) {
          skippedNoAltegioId++;
          skippedCount++;
          continue;
        }

        // Отримуємо дані клієнта з Altegio API через наш протестований endpoint
        const altegioClient = await getClient(companyId, client.altegioClientId);

        if (!altegioClient) {
          console.log(`[direct/sync-spent-visits] ⚠️ Client ${client.id} (Altegio ID: ${client.altegioClientId}) not found in API`);
          skippedNotFound++;
          skippedCount++;
          details.push({
            instagramUsername: client.instagramUsername,
            altegioClientId: client.altegioClientId,
            status: 'not_found_in_api',
          });
          
          // Затримка навіть при помилці для дотримання rate limit
          if (i < clientsWithAltegioId.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
          }
          continue;
        }

        // Отримуємо spent та visits з API
        // Altegio API може повертати visits_count або success_visits_count замість visits (UI використовує visits_count)
        const spent = altegioClient.spent ?? (altegioClient as any).total_spent ?? null;
        const visits =
          (typeof (altegioClient as any).visits === 'number' ? (altegioClient as any).visits : null) ??
          (typeof (altegioClient as any).visits_count === 'number' ? (altegioClient as any).visits_count : null) ??
          (typeof (altegioClient as any).success_visits_count === 'number' ? (altegioClient as any).success_visits_count : null) ??
          null;

        // #region agent log
        const visitKeys = Object.keys(altegioClient).filter(k => k.toLowerCase().includes('visit'));
        const visitVals = visitKeys.reduce((acc: Record<string, unknown>, k) => { acc[k] = (altegioClient as any)[k]; return acc; }, {});
        debugLog('Sync client API response', { location: 'sync-spent-visits:102', instagramUsername: client.instagramUsername, altegioClientId: client.altegioClientId, dbVisits: client.visits, apiVisits: visits, apiSpent: spent, visitKeys, visitVals, firstName: client.firstName, lastName: client.lastName }, 'B,E');
        // #endregion

        console.log(`[direct/sync-spent-visits] Client ${i + 1}/${clientsWithAltegioId.length} (${client.instagramUsername}): API spent=${spent}, visits=${visits}, DB spent=${client.spent}, visits=${client.visits}`);

        // Перевіряємо, чи потрібно оновити дані
        const needsUpdate = 
          (spent !== null && client.spent !== spent) ||
          (visits !== null && client.visits !== visits);

        if (!needsUpdate) {
          skippedNoUpdate++;
          
          // Затримка для дотримання rate limit
          if (i < clientsWithAltegioId.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
          }
          continue;
        }

        // Оновлюємо клієнта
        const updatedClient = {
          ...client,
          spent: spent !== null ? spent : client.spent,
          visits: visits !== null ? visits : client.visits,
          updatedAt: new Date().toISOString(),
        };

        // #region agent log
        debugLog('Saving client with visits', { location: 'sync-spent-visits:128', instagramUsername: client.instagramUsername, altegioClientId: client.altegioClientId, visitsToSave: updatedClient.visits, spentToSave: updatedClient.spent }, 'C');
        // #endregion

        await saveDirectClient(updatedClient, 'sync-spent-visits', {
          altegioClientId: client.altegioClientId,
          spent,
          visits,
          reason: 'Synced from Altegio API',
        }, { touchUpdatedAt: false });

        updatedCount++;
        console.log(`[direct/sync-spent-visits] ✅ Updated client ${client.id} (${client.instagramUsername}): spent=${spent}, visits=${visits}`);
      } catch (err) {
        const errorMsg = `Failed to sync client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[direct/sync-spent-visits] ❌ ${errorMsg}`, err);
      }

      // Затримка між запитами для дотримання rate limit (крім останнього запиту)
      if (i < clientsWithAltegioId.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    }

    // Загальна кількість пропущених = ті, що без Altegio ID + не знайдені в API + не потребували оновлення
    skippedCount = skippedNoAltegioId + skippedNotFound + skippedNoUpdate;

    return NextResponse.json({
      ok: true,
      message: `Sync completed. Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`,
      stats: {
        totalClients: allClients.length,
        updated: updatedCount,
        skipped: skippedCount,
        skippedNoAltegioId,
        skippedNotFound,
        skippedNoUpdate,
        errors: errors.length,
      },
      details: details.slice(0, 50),
      errors: errors.length > 0 ? errors.slice(0, 20) : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[direct/sync-spent-visits] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
