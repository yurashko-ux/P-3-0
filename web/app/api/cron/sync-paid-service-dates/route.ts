// web/app/api/cron/sync-paid-service-dates/route.ts
// Автоматична синхронізація paidServiceDate зі старих вебхуків для клієнтів, які з'явилися пізніше
// Запускається автоматично раз на годину

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { kvRead } from '@/lib/kv';
import { saveDirectClient, getAllDirectClients } from '@/lib/direct-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Перевіряє, чи це консультація
 */
function isConsultationService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) {
    return false;
  }
  
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    return /консультаці/i.test(title);
  });
}

/**
 * Перевіряє, чи є платна послуга (не консультація)
 */
function hasPaidService(services: any[]): boolean {
  if (!Array.isArray(services) || services.length === 0) {
    return false;
  }
  
  return services.some((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    if (/консультаці/i.test(title)) {
      return false;
    }
    return true;
  });
}

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
 * GET/POST - викликається cron job для автоматичної синхронізації paidServiceDate
 */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
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

    console.log('[cron/sync-paid-service-dates] Starting automatic paidServiceDate sync...');

    // Отримуємо всіх клієнтів з Direct Manager
    const allClients = await getAllDirectClients();
    console.log(`[cron/sync-paid-service-dates] Found ${allClients.length} clients in Direct Manager`);

    // Фільтруємо клієнтів, які мають altegioClientId, але не мають paidServiceDate
    const clientsToCheck = allClients.filter(
      (c) => c.altegioClientId && !c.paidServiceDate
    );
    console.log(`[cron/sync-paid-service-dates] Found ${clientsToCheck.length} clients with altegioClientId but without paidServiceDate`);

    if (clientsToCheck.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No clients need sync',
        stats: {
          totalClients: allClients.length,
          checked: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Отримуємо всі записи з records:log
    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[cron/sync-paid-service-dates] Found ${rawItems.length} records in records:log`);

    // Парсимо записи
    const records = rawItems
      .map((raw) => {
        try {
          const parsed = unwrapKVResponse(raw);
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId && r.datetime && r.data && Array.isArray(r.data.services));

    console.log(`[cron/sync-paid-service-dates] Parsed ${records.length} valid records`);

    // Створюємо мапу: clientId -> найновіша дата платної послуги
    const clientPaidServiceDates = new Map<number, { datetime: string; services: any[] }>();

    for (const record of records) {
      const clientId = parseInt(String(record.clientId), 10);
      if (isNaN(clientId)) continue;

      const services = record.data.services || [];
      if (services.length === 0) continue;

      // Пропускаємо консультації
      if (isConsultationService(services)) continue;

      // Перевіряємо, чи є платна послуга
      if (!hasPaidService(services)) continue;

      const datetime = record.datetime || record.data?.datetime;
      if (!datetime) continue;

      const existing = clientPaidServiceDates.get(clientId);
      const recordDate = new Date(datetime);
      
      if (!existing || new Date(existing.datetime) < recordDate) {
        clientPaidServiceDates.set(clientId, { datetime, services });
      }
    }

    console.log(`[cron/sync-paid-service-dates] Found paid service dates for ${clientPaidServiceDates.size} clients`);

    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Оновлюємо клієнтів
    for (const client of clientsToCheck) {
      if (!client.altegioClientId) {
        skippedCount++;
        continue;
      }

      const paidServiceInfo = clientPaidServiceDates.get(client.altegioClientId);
      if (!paidServiceInfo) {
        skippedCount++;
        continue;
      }

      try {
        const updated: typeof client = {
          ...client,
          paidServiceDate: paidServiceInfo.datetime,
          signedUpForPaidService: true,
          updatedAt: new Date().toISOString(),
        };

        await saveDirectClient(updated, 'cron-sync-paid-service-dates', {
          altegioClientId: client.altegioClientId,
          datetime: paidServiceInfo.datetime,
          services: paidServiceInfo.services.map((s: any) => ({ id: s.id, title: s.title })),
          reason: 'Auto-synced from old webhooks',
        });

        updatedCount++;
        console.log(`[cron/sync-paid-service-dates] ✅ Updated client ${client.id} (${client.instagramUsername}): set paidServiceDate to ${paidServiceInfo.datetime}`);
      } catch (err) {
        const errorMsg = `Failed to update client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[cron/sync-paid-service-dates] ❌ ${errorMsg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Automatic paidServiceDate sync completed',
      stats: {
        totalClients: allClients.length,
        checked: clientsToCheck.length,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 10) : [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[cron/sync-paid-service-dates] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
