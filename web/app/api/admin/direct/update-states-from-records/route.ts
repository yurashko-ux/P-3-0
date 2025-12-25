// web/app/api/admin/direct/update-states-from-records/route.ts
// Оновлення стану всіх клієнтів на основі записів з Altegio

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';

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
          const parsed = JSON.parse(raw);
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return null;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId && r.data && Array.isArray(r.data.services));

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
      if (!record || !record.data || !Array.isArray(record.data.services)) {
        skippedCount++;
        continue;
      }

      const services = record.data.services;
      
      // Визначаємо новий стан на основі послуг
      let newState: 'consultation' | 'hair-extension' | null = null;
      
      // Перевіряємо, чи є послуга "Консультація"
      const hasConsultation = services.some((s: any) => 
        s.title && /консультація/i.test(s.title)
      );
      
      // Перевіряємо, чи є послуга з "Нарощування волосся"
      const hasHairExtension = services.some((s: any) => 
        s.title && /нарощування.*волосся/i.test(s.title)
      );
      
      if (hasConsultation) {
        newState = 'consultation';
      } else if (hasHairExtension) {
        newState = 'hair-extension';
      }

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

