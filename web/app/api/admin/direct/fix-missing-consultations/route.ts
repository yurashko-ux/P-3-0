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
    console.log(`[direct/fix-missing-consultations] Found ${recordsLogRaw.length} records in altegio:records:log`);
    
    // Також перевіряємо webhook log як резервний варіант
    const webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 999);
    console.log(`[direct/fix-missing-consultations] Found ${webhookLogRaw.length} records in altegio:webhook:log`);
    
    if (recordsLogRaw.length === 0 && webhookLogRaw.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No records found in Altegio logs',
        stats: {
          totalClients: clientsWithHairExtension.length,
          fixed: 0,
          skipped: clientsWithHairExtension.length,
          errors: 0,
        },
        errors: [],
        warning: 'No records found in altegio:records:log or altegio:webhook:log. Webhooks may not be saving records.',
      });
    }
    
    // Парсимо webhook log для отримання record events
    const webhookRecords = webhookLogRaw
      .map((raw) => {
        try {
          let parsed: any;
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else {
            parsed = raw;
          }
          
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
            try {
              parsed = JSON.parse(parsed.value);
            } catch {
              return null;
            }
          }
          
          // Перевіряємо, чи це record event
          if (parsed && parsed.body && parsed.body.resource === 'record' && parsed.body.data) {
            const data = parsed.body.data;
            return {
              clientId: data.client?.id || data.client_id,
              visitId: parsed.body.resource_id,
              status: parsed.body.status,
              datetime: data.datetime,
              receivedAt: parsed.receivedAt,
              data: {
                services: data.services || (data.service ? [data.service] : []),
                client: data.client,
                staff: data.staff,
              },
            };
          }
          
          return null;
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.clientId && Array.isArray(r.data?.services) && r.data.services.length > 0);
    
    console.log(`[direct/fix-missing-consultations] Found ${webhookRecords.length} record events in webhook log`);

    // Парсимо записи з records log
    const recordsFromLog = recordsLogRaw
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
    
    // Об'єднуємо записи з обох джерел (records log має пріоритет)
    const records = [...recordsFromLog, ...webhookRecords];
    console.log(`[direct/fix-missing-consultations] Total records after merge: ${records.length} (${recordsFromLog.length} from records log, ${webhookRecords.length} from webhook log)`);

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
          
          // Шукаємо записи з обома послугами в ОДНОМУ записі
          const recordsWithBothServices = allClientRecords
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
          
          // Якщо не знайшли запис з обома послугами в одному записі,
          // шукаємо консультацію в окремому записі, який був до нарощування
          let clientRecords = recordsWithBothServices;
          
          if (recordsWithBothServices.length === 0) {
            console.log(`[fix-missing-consultations] No record with both services in one visit for client ${client.altegioClientId}, checking separate records...`);
            
            // Знаходимо всі записи з консультацією
            const consultationRecords = allClientRecords
              .filter((r) => {
                const services = r.data?.services || r.services || [];
                if (!Array.isArray(services) || services.length === 0) return false;
                return services.some((s: any) => {
                  const title = s.title || s.name || '';
                  return /консультація/i.test(title);
                });
              })
              .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());
            
            // Знаходимо всі записи з нарощуванням
            const hairExtensionRecords = allClientRecords
              .filter((r) => {
                const services = r.data?.services || r.services || [];
                if (!Array.isArray(services) || services.length === 0) return false;
                return services.some((s: any) => {
                  const title = s.title || s.name || '';
                  return /нарощування/i.test(title);
                });
              })
              .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());
            
            console.log(`[fix-missing-consultations] Client ${client.altegioClientId}: ${consultationRecords.length} consultation records, ${hairExtensionRecords.length} hair extension records`);
            
            // Якщо є і консультація, і нарощування в різних записах,
            // використовуємо найближчу консультацію до нарощування
            if (consultationRecords.length > 0 && hairExtensionRecords.length > 0) {
              const latestHairExtension = hairExtensionRecords[0];
              const hairExtensionDate = new Date(latestHairExtension.receivedAt || latestHairExtension.datetime || 0);
              
              // Знаходимо консультацію, яка була до або в той же день, що і нарощування
              const relevantConsultation = consultationRecords.find((cr) => {
                const consultationDate = new Date(cr.receivedAt || cr.datetime || 0);
                return consultationDate <= hairExtensionDate;
              });
              
              if (relevantConsultation) {
                console.log(`[fix-missing-consultations] Found consultation record before/on hair extension date for client ${client.altegioClientId}`);
                // Створюємо "віртуальний" запис з обома послугами
                clientRecords = [{
                  ...latestHairExtension,
                  data: {
                    ...latestHairExtension.data,
                    services: [
                      ...(relevantConsultation.data?.services || relevantConsultation.services || []),
                      ...(latestHairExtension.data?.services || latestHairExtension.services || []),
                    ],
                  },
                  receivedAt: latestHairExtension.receivedAt || latestHairExtension.datetime,
                }];
              }
            }
          }

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
            // Детальна діагностика - показуємо всі послуги для цього клієнта
            const allServices = allClientRecords
              .flatMap((r) => {
                const services = r.data?.services || r.services || [];
                return Array.isArray(services) ? services.map((s: any) => ({
                  title: s.title || s.name || 'Unknown',
                  id: s.id,
                  recordDate: r.receivedAt || r.datetime,
                })) : [];
              })
              .filter((s, index, self) => 
                index === self.findIndex((t) => t.title === s.title && t.id === s.id)
              );
            
            console.log(`[fix-missing-consultations] No records with both services found for client ${client.id} (Altegio ${client.altegioClientId})`);
            console.log(`[fix-missing-consultations] All services for this client:`, allServices.map(s => s.title).join(', '));
            console.log(`[fix-missing-consultations] Has consultation in any record:`, allServices.some(s => /консультація/i.test(s.title)));
            console.log(`[fix-missing-consultations] Has hair extension in any record:`, allServices.some(s => /нарощування/i.test(s.title)));
            
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

    // Додаємо детальну діагностику
    const diagnostics: any[] = [];
    for (const client of clientsWithHairExtension.slice(0, 5)) { // Перші 5 для діагностики
      const clientRecords = records.filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const recordClientId = r.clientId || 
                               (r.data && r.data.client && r.data.client.id) ||
                               (r.data && r.data.client_id);
        if (!recordClientId) return false;
        return parseInt(String(recordClientId), 10) === client.altegioClientId;
      });
      
      const recordsWithServices = clientRecords.filter((r) => {
        const services = r.data?.services || r.services || [];
        return Array.isArray(services) && services.length > 0;
      });
      
      // Збираємо всі унікальні послуги
      const allServices = recordsWithServices
        .flatMap((r) => {
          const services = r.data?.services || r.services || [];
          return Array.isArray(services) ? services.map((s: any) => ({
            title: s.title || s.name || 'Unknown',
            id: s.id,
            recordDate: r.receivedAt || r.datetime,
          })) : [];
        })
        .filter((s, index, self) => 
          index === self.findIndex((t) => t.title === s.title && t.id === s.id)
        );
      
      const hasConsultation = allServices.some(s => /консультація/i.test(s.title));
      const hasHairExtension = allServices.some(s => /нарощування/i.test(s.title));
      
      // Знаходимо записи з консультацією
      const consultationRecords = recordsWithServices.filter((r) => {
        const services = r.data?.services || r.services || [];
        return Array.isArray(services) && services.some((s: any) => {
          const title = s.title || s.name || '';
          return /консультація/i.test(title);
        });
      });
      
      // Знаходимо записи з нарощуванням
      const hairExtensionRecords = recordsWithServices.filter((r) => {
        const services = r.data?.services || r.services || [];
        return Array.isArray(services) && services.some((s: any) => {
          const title = s.title || s.name || '';
          return /нарощування/i.test(title);
        });
      });
      
      diagnostics.push({
        clientId: client.id,
        instagramUsername: client.instagramUsername,
        altegioClientId: client.altegioClientId,
        totalRecords: clientRecords.length,
        recordsWithServices: recordsWithServices.length,
        hasConsultation: hasConsultation,
        hasHairExtension: hasHairExtension,
        consultationRecordsCount: consultationRecords.length,
        hairExtensionRecordsCount: hairExtensionRecords.length,
        allServices: allServices.map(s => s.title),
        sampleRecord: recordsWithServices.length > 0 ? {
          clientId: recordsWithServices[0].clientId,
          hasDataServices: !!recordsWithServices[0].data?.services,
          hasTopLevelServices: !!recordsWithServices[0].services,
          servicesCount: (recordsWithServices[0].data?.services || recordsWithServices[0].services || []).length,
          services: (recordsWithServices[0].data?.services || recordsWithServices[0].services || []).map((s: any) => ({
            id: s.id,
            title: s.title || s.name,
          })),
        } : null,
      });
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
      diagnostics: diagnostics,
      totalRecordsInKV: recordsLogRaw.length,
      parsedRecords: records.length,
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
