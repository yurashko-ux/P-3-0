// web/app/api/admin/direct/cleanup-paid-service-dates/route.ts
// API endpoint для очищення помилково встановлених paidServiceDate для клієнтів з консультаціями

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
 * Перевіряє, чи клієнт має тільки консультації (без платних послуг)
 */
async function hasOnlyConsultations(altegioClientId: number | null | undefined): Promise<boolean> {
  if (!altegioClientId) return false;
  
  try {
    // Отримуємо всі записи з records:log
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    const clientRecords = recordsLogRaw
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
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
      .filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const recordClientId = r.clientId || (r.data && r.data.client && r.data.client.id) || (r.data && r.data.client_id);
        if (!recordClientId) return false;
        const parsedClientId = parseInt(String(recordClientId), 10);
        return !isNaN(parsedClientId) && parsedClientId === altegioClientId;
      })
      .filter((r) => {
        // Перевіряємо, що запис має services
        const services = r.data?.services || r.services || [];
        return Array.isArray(services) && services.length > 0;
      });

    // Перевіряємо, чи всі послуги - це консультації
    for (const record of clientRecords) {
      const services = record.data?.services || record.services || [];
      const hasNonConsultation = services.some((s: any) => {
        const title = s.title || s.name || '';
        return !/консультація/i.test(title);
      });
      
      if (hasNonConsultation) {
        // Знайдено платну послугу
        return false;
      }
    }
    
    // Якщо є записи і всі вони - консультації
    return clientRecords.length > 0;
  } catch (err) {
    console.warn(`[cleanup-paid-service-dates] Failed to check consultation history for client ${altegioClientId}:`, err);
    return false;
  }
}

/**
 * POST - очистити помилково встановлені paidServiceDate для клієнтів з консультаціями
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clients = await getAllDirectClients();
    const cleaned: string[] = [];
    const errors: string[] = [];

    for (const client of clients) {
      // Перевіряємо, чи клієнт має paidServiceDate, але не має signedUpForPaidService
      // або має тільки консультації
      if (client.paidServiceDate && client.altegioClientId) {
        const onlyConsultations = await hasOnlyConsultations(client.altegioClientId);
        
        if (!client.signedUpForPaidService || onlyConsultations) {
          try {
            const updates: Partial<typeof client> = {
              paidServiceDate: undefined,
              signedUpForPaidService: false,
              updatedAt: new Date().toISOString(),
            };
            
            const updated = {
              ...client,
              ...updates,
            };
            
            await saveDirectClient(updated, 'cleanup-paid-service-dates', {
              reason: onlyConsultations ? 'only consultations' : 'signedUpForPaidService is false',
              altegioClientId: client.altegioClientId,
            });
            
            cleaned.push(`${client.instagramUsername} (${client.firstName} ${client.lastName})`);
            console.log(`[cleanup-paid-service-dates] ✅ Cleaned paidServiceDate for client ${client.id} (${client.instagramUsername})`);
          } catch (err) {
            const errorMsg = `Failed to clean ${client.instagramUsername}: ${err instanceof Error ? err.message : String(err)}`;
            errors.push(errorMsg);
            console.error(`[cleanup-paid-service-dates] ❌ ${errorMsg}`);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      total: clients.length,
      cleaned: cleaned.length,
      cleanedClients: cleaned,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[cleanup-paid-service-dates] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

