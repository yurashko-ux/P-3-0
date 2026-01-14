// web/app/api/admin/direct/sync-spent-visits/route.ts
// Синхронізація spent та visits з Altegio API для всіх клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { getClient } from '@/lib/altegio/clients';
import { saveDirectClient } from '@/lib/direct-store';
import { ALTEGIO_ENV } from '@/lib/altegio/env';

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
    // Перевірка авторизації
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = parseInt(ALTEGIO_ENV.PARTNER_ID || '', 10);
    if (!companyId || isNaN(companyId)) {
      return NextResponse.json({
        ok: false,
        error: 'ALTEGIO_PARTNER_ID not configured',
      }, { status: 500 });
    }

    console.log(`[direct/sync-spent-visits] Starting sync for company ${companyId}...`);

    // Отримуємо всіх клієнтів з бази даних
    const allClients = await getAllDirectClients();
    console.log(`[direct/sync-spent-visits] Found ${allClients.length} clients in database`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Обробляємо клієнтів по черзі
    for (const client of allClients) {
      try {
        // Пропускаємо клієнтів без altegioClientId
        if (!client.altegioClientId) {
          skippedCount++;
          continue;
        }

        // Отримуємо дані клієнта з Altegio API
        const altegioClient = await getClient(companyId, client.altegioClientId);

        if (!altegioClient) {
          console.log(`[direct/sync-spent-visits] ⚠️ Client ${client.id} (Altegio ID: ${client.altegioClientId}) not found in API`);
          skippedCount++;
          continue;
        }

        // Отримуємо spent та visits з API
        const spent = altegioClient.spent ?? null;
        const visits = altegioClient.visits ?? null;

        // Перевіряємо, чи потрібно оновити дані
        const needsUpdate = 
          (spent !== null && client.spent !== spent) ||
          (visits !== null && client.visits !== visits);

        if (!needsUpdate) {
          skippedCount++;
          continue;
        }

        // Оновлюємо клієнта
        const updatedClient = {
          ...client,
          spent: spent !== null ? spent : client.spent,
          visits: visits !== null ? visits : client.visits,
          updatedAt: new Date().toISOString(),
        };

        await saveDirectClient(updatedClient, 'sync-spent-visits', {
          altegioClientId: client.altegioClientId,
          spent,
          visits,
          reason: 'Synced from Altegio API',
        });

        updatedCount++;
        console.log(`[direct/sync-spent-visits] ✅ Updated client ${client.id} (${client.instagramUsername}): spent=${spent}, visits=${visits}`);
      } catch (err) {
        const errorMsg = `Failed to sync client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[direct/sync-spent-visits] ❌ ${errorMsg}`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Sync completed. Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`,
      stats: {
        totalClients: allClients.length,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
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
