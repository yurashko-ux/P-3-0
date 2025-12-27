// web/app/api/admin/direct/fix-missing-consultations/route.ts
// API endpoint для виправлення пропущених консультацій в історії станів

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
import { getStateHistory } from '@/lib/direct-state-log';

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
 * POST - виправити пропущені консультації в історії станів
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[direct/fix-missing-consultations] Starting fix for missing consultations...');

    // Отримуємо всіх клієнтів зі станом "Нарощування волосся"
    const allClients = await getAllDirectClients();
    const clientsWithHairExtension = allClients.filter(
      (c) => c.state === 'hair-extension' && c.altegioClientId
    );

    console.log(`[direct/fix-missing-consultations] Found ${clientsWithHairExtension.length} clients with hair-extension state`);

    // Отримуємо всі записи з Altegio records log
    const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[direct/fix-missing-consultations] Found ${recordsLogRaw.length} records in Altegio log`);
    
    if (recordsLogRaw.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No records found in Altegio log',
        stats: {
          totalClients: clientsWithHairExtension.length,
          fixed: 0,
          skipped: clientsWithHairExtension.length,
          errors: 0,
        },
        errors: [],
        warning: 'No records found in altegio:records:log. Webhooks may not be saving records.',
      });
    }

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
          
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              parsed = JSON.parse(parsed.value);
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
        const hasClientId = r.clientId || (r.data && r.data.client && r.data.client.id);
        const hasServices = Array.isArray(r.services) || 
                          (r.data && Array.isArray(r.data.services));
        return hasClientId && hasServices;
      });

    let fixedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Перевіряємо кожного клієнта
    for (const client of clientsWithHairExtension) {
      try {
        // Перевіряємо історію клієнта
        const history = await getStateHistory(client.id);
        const hasConsultation = history.some(log => log.state === 'consultation');
        const hasHairExtension = history.some(log => log.state === 'hair-extension');

        // Якщо є нарощування, але немає консультації - шукаємо записи
        if (hasHairExtension && !hasConsultation) {
          console.log(`[fix-missing-consultations] Checking client ${client.id} (Altegio ${client.altegioClientId}, Instagram: ${client.instagramUsername})`);
          
          // Шукаємо записи для цього клієнта
          const allClientRecords = records.filter((r) => {
            if (!r || typeof r !== 'object') return false;
            
            // Перевіряємо різні формати clientId
            const recordClientId = r.clientId || 
                                 (r.data && r.data.client && r.data.client.id) ||
                                 (r.data && r.data.client_id);
            
            if (!recordClientId) return false;
            
            const parsedClientId = parseInt(String(recordClientId), 10);
            const targetClientId = client.altegioClientId;
            
            return !isNaN(parsedClientId) && parsedClientId === targetClientId;
          });
          
          console.log(`[fix-missing-consultations] Found ${allClientRecords.length} records for client ${client.altegioClientId}`);
          
          // Шукаємо записи з обома послугами
          const clientRecords = allClientRecords
            .filter((r) => {
              // Перевіряємо services в різних місцях
              const services = r.data?.services || 
                              r.services || 
                              (r.data && Array.isArray(r.data.service) ? r.data.service : [r.data?.service].filter(Boolean)) ||
                              [];
              
              if (!Array.isArray(services) || services.length === 0) {
                return false;
              }
              
              const hasConsultation = services.some((s: any) => {
                const title = s.title || s.name || '';
                return /консультація/i.test(title);
              });
              
              const hasHairExtension = services.some((s: any) => {
                const title = s.title || s.name || '';
                return /нарощування/i.test(title);
              });
              
              if (hasConsultation && hasHairExtension) {
                console.log(`[fix-missing-consultations] Found record with both services for client ${client.altegioClientId}:`, {
                  services: services.map((s: any) => s.title || s.name),
                  receivedAt: r.receivedAt,
                });
              }
              
              return hasConsultation && hasHairExtension;
            })
            .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

          if (clientRecords.length > 0) {
            const latestRecord = clientRecords[0];
            const hairExtensionLog = history.find(log => log.state === 'hair-extension');
            
            if (hairExtensionLog) {
              // Перевіряємо, чи вже є консультація з такою ж датою
              const recordDate = latestRecord.receivedAt || latestRecord.data?.datetime || latestRecord.datetime || hairExtensionLog.createdAt;
              const consultationDate = new Date(recordDate);
              
              if (isNaN(consultationDate.getTime())) {
                console.warn(`[fix-missing-consultations] Invalid date for client ${client.id}: ${recordDate}`);
                skippedCount++;
                continue;
              }
              
              const existingConsultation = history.find(log => 
                log.state === 'consultation' && 
                Math.abs(new Date(log.createdAt).getTime() - consultationDate.getTime()) < 60000
              );
              
              if (!existingConsultation) {
                // Створюємо запис про консультацію
                const consultationLogId = `missing-consultation-${client.id}-${Date.now()}`;
                const metadata = hairExtensionLog.metadata || (client.masterId ? JSON.stringify({ masterId: client.masterId }) : undefined);
                
                await prisma.directClientStateLog.create({
                  data: {
                    id: consultationLogId,
                    clientId: client.id,
                    state: 'consultation',
                    previousState: hairExtensionLog.previousState,
                    reason: 'retroactive-fix',
                    metadata: metadata || null,
                    createdAt: consultationDate,
                  },
                });
                
                fixedCount++;
                console.log(`[fix-missing-consultations] ✅ Created consultation log for client ${client.id} (${client.instagramUsername}) at ${consultationDate.toISOString()}`);
              } else {
                console.log(`[fix-missing-consultations] Consultation already exists for client ${client.id}`);
                skippedCount++;
              }
            } else {
              console.log(`[fix-missing-consultations] No hair-extension log found in history for client ${client.id}`);
              skippedCount++;
            }
          } else {
            console.log(`[fix-missing-consultations] No records with both services found for client ${client.id} (Altegio ${client.altegioClientId})`);
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      } catch (err) {
        const errorMsg = `Failed to fix client ${client.id}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(errorMsg);
        console.error(`[direct/fix-missing-consultations] ❌ ${errorMsg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Fix completed',
      stats: {
        totalClients: clientsWithHairExtension.length,
        fixed: fixedCount,
        skipped: skippedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors.slice(0, 10) : [],
    });
  } catch (error) {
    console.error('[direct/fix-missing-consultations] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
