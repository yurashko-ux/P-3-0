// web/app/api/admin/direct/update-states-from-records/route.ts
// Оновлення стану всіх клієнтів на основі записів з Altegio

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { determineStateFromServices } from '@/lib/direct-state-helper';

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

/**
 * POST - оновити стани всіх клієнтів на основі записів з Altegio
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[direct/update-states-from-records] Starting state update for all clients...');

    // Отримуємо всіх клієнтів з Direct Manager
    const allClients = await getAllDirectClients();
    console.log(`[direct/update-states-from-records] Found ${allClients.length} clients in Direct Manager`);

    // Отримуємо всі записи з Altegio records log
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[direct/update-states-from-records] Found ${recordsLogRaw.length} records in Altegio log`);

    // Парсимо записи
    const records = recordsLogRaw
      .map((raw) => {
        try {
          let parsed: any;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else {
            parsed = raw;
          }
          
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              // Якщо не вдалося розпарсити value, залишаємо як є
            }
          }
          
          // Також перевіряємо, чи це не обгортка з data
          if (parsed && typeof parsed === 'object' && 'data' in parsed && !parsed.clientId) {
            parsed = parsed.data;
          }
          
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => {
        if (!r || typeof r !== 'object') return false;
        // Перевіряємо різні формати записів
        const hasClientId = r.clientId || (r.data && r.data.client && r.data.client.id);
        const hasServices = Array.isArray(r.services) || 
                          (r.data && Array.isArray(r.data.services)) ||
                          (r.data && r.data.service && typeof r.data.service === 'object');
        return hasClientId && hasServices;
      })
      .map((r) => {
        // Нормалізуємо формат запису
        if (r.data && r.data.services) {
          return {
            clientId: r.clientId || (r.data.client && r.data.client.id),
            data: r.data,
            receivedAt: r.receivedAt || new Date().toISOString(),
          };
        }
        if (r.services) {
          return {
            clientId: r.clientId || (r.client && r.client.id),
            data: { services: r.services },
            receivedAt: r.receivedAt || new Date().toISOString(),
          };
        }
        return r;
      });

    console.log(`[direct/update-states-from-records] Parsed ${records.length} valid records`);

    // Групуємо записи по clientId, беремо останній запис для кожного клієнта
    const recordsByClient = new Map<number, any>();
    for (const record of records) {
      const clientId = parseInt(String(record.clientId), 10);
      if (!isNaN(clientId)) {
        const existing = recordsByClient.get(clientId);
        if (!existing || new Date(record.receivedAt) > new Date(existing.receivedAt)) {
          recordsByClient.set(clientId, record);
        }
      }
    }

    console.log(`[direct/update-states-from-records] Found records for ${recordsByClient.size} unique clients`);

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
      if (!record) {
        skippedCount++;
        continue;
      }

      // Отримуємо services з різних можливих місць
      let services: any[] = [];
      if (record.data && Array.isArray(record.data.services)) {
        services = record.data.services;
      } else if (Array.isArray(record.services)) {
        services = record.services;
      } else if (record.data && record.data.service && typeof record.data.service === 'object') {
        services = [record.data.service];
      }
      
      if (services.length === 0) {
        skippedCount++;
        continue;
      }
      
      // Визначаємо новий стан на основі послуг (з пріоритетом)
      const newState = determineStateFromServices(services);

      // Якщо знайшли новий стан і він відрізняється від поточного - оновлюємо
      // Якщо newState === null, залишаємо поточний стан
      if (newState && client.state !== newState) {
        try {
          const updated: typeof client = {
            ...client,
            state: newState,
            updatedAt: new Date().toISOString(),
          };
          await saveDirectClient(updated, 'manual-update-states', {
            altegioClientId: client.altegioClientId,
            services: services.map((s: any) => ({ id: s.id, title: s.title })),
          });
          updatedCount++;
          console.log(`[direct/update-states-from-records] ✅ Updated client ${client.id} (Altegio ${client.altegioClientId}) state to '${newState}'`);
        } catch (err) {
          const errorMsg = `Failed to update client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(errorMsg);
          console.error(`[direct/update-states-from-records] ❌ ${errorMsg}`);
        }
      } else {
        skippedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'State update completed',
      stats: {
        totalClients: allClients.length,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 10) : [], // Перші 10 помилок
    });
  } catch (error) {
    console.error('[direct/update-states-from-records] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

