// web/app/api/cron/update-direct-states/route.ts
// Автоматичне оновлення станів клієнтів раз на годину

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { determineStateFromServices } from '@/lib/direct-state-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Рекурсивно розгортає KV відповідь
 */
function unwrapKVResponse(data: any): any {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && 'value' in parsed) {
        return unwrapKVResponse(parsed.value);
      }
      return parsed;
    } catch {
      return data;
    }
  }
  if (data && typeof data === 'object' && 'value' in data) {
    return unwrapKVResponse(data.value);
  }
  return data;
}

/**
 * GET - викликається cron job для автоматичного оновлення станів
 */
export async function GET(req: NextRequest) {
  try {
    // Перевірка авторизації через CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    const secretParam = req.nextUrl.searchParams.get('secret');
    
    if (cronSecret) {
      const isAuthorized = 
        authHeader === `Bearer ${cronSecret}` ||
        secretParam === cronSecret;
      
      if (!isAuthorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log('[cron/update-direct-states] Starting automatic state update...');

    // Отримуємо всіх клієнтів з Direct Manager
    const allClients = await getAllDirectClients();
    console.log(`[cron/update-direct-states] Found ${allClients.length} clients in Direct Manager`);

    // Отримуємо всі записи з Altegio records log
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[cron/update-direct-states] Found ${recordsLogRaw.length} records in Altegio log`);

    // Парсимо записи
    const records = recordsLogRaw
      .map((raw) => {
        try {
          const parsed = unwrapKVResponse(raw);
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId && r.data && Array.isArray(r.data.services));

    console.log(`[cron/update-direct-states] Parsed ${records.length} valid records`);

    // Групуємо записи по clientId, беремо останній запис для кожного клієнта
    const recordsByClient = new Map<number, any>();
    for (const record of records) {
      const clientId = parseInt(String(record.clientId), 10);
      if (!isNaN(clientId)) {
        const existing = recordsByClient.get(clientId);
        if (!existing || new Date(record.receivedAt || 0) > new Date(existing.receivedAt || 0)) {
          recordsByClient.set(clientId, record);
        }
      }
    }

    console.log(`[cron/update-direct-states] Found records for ${recordsByClient.size} unique clients`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Оновлюємо стани клієнтів
    for (const client of allClients) {
      if (!client.altegioClientId) {
        skippedCount++;
        continue;
      }

      const record = recordsByClient.get(client.altegioClientId);
      if (!record || !record.data || !Array.isArray(record.data.services)) {
        skippedCount++;
        continue;
      }

      const services = record.data.services;
      
      // Визначаємо новий стан на основі послуг (з пріоритетом)
      const newState = determineStateFromServices(services);

      // Якщо знайшли новий стан і він відрізняється від поточного - оновлюємо
      if (newState && client.state !== newState) {
        try {
          const updated: typeof client = {
            ...client,
            state: newState,
            updatedAt: new Date().toISOString(),
          };
          await saveDirectClient(updated);
          updatedCount++;
          console.log(`[cron/update-direct-states] ✅ Updated client ${client.id} (Altegio ${client.altegioClientId}) state to '${newState}'`);
        } catch (err) {
          const errorMsg = `Failed to update client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(errorMsg);
          console.error(`[cron/update-direct-states] ❌ ${errorMsg}`);
        }
      } else {
        skippedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Automatic state update completed',
      stats: {
        totalClients: allClients.length,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 5) : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron/update-direct-states] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
