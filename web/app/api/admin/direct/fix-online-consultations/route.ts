// web/app/api/admin/direct/fix-online-consultations/route.ts
// Оновлює isOnlineConsultation для існуючих клієнтів на основі webhook'ів

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  
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
 * Перевіряє, чи є послуга "Консультація" або "Онлайн-консультація"
 * Повертає об'єкт з інформацією про те, чи це консультація та чи це онлайн-консультація
 */
function isConsultationService(services: any[]): { isConsultation: boolean; isOnline: boolean } {
  if (!Array.isArray(services) || services.length === 0) {
    return { isConsultation: false, isOnline: false };
  }
  
  let isConsultation = false;
  let isOnline = false;
  
  services.forEach((s: any) => {
    const title = (s.title || s.name || '').toLowerCase();
    const originalTitle = s.title || s.name || '';
    
    if (/консультація/i.test(title)) {
      isConsultation = true;
      // Перевіряємо, чи це онлайн-консультація
      // Перевіряємо різні варіанти написання: "онлайн", "online", дефіс або пробіл
      if (/онлайн/i.test(title) || 
          /online/i.test(title) || 
          /онлайн-консультація/i.test(title) ||
          /online-консультація/i.test(title) ||
          /онлайн консультація/i.test(title) ||
          /online консультація/i.test(title)) {
        isOnline = true;
      }
    }
  });
  
  return { isConsultation, isOnline };
}

// Функція для обробки оновлення
async function fixOnlineConsultations() {
  // Отримуємо всіх клієнтів з altegioClientId, у яких isOnlineConsultation не встановлено або false
  // Перевіряємо всіх клієнтів, у яких може бути онлайн-консультація в webhook'ах
  const allClients = await getAllDirectClients();
  
  try {
    // Фільтруємо клієнтів: мають altegioClientId і isOnlineConsultation = false або undefined
    const clientsToCheck = allClients.filter(
      (c) => c.altegioClientId && (!c.isOnlineConsultation || c.isOnlineConsultation === undefined)
    );

    console.log(`[fix-online-consultations] Всього клієнтів: ${allClients.length}`);
    console.log(`[fix-online-consultations] Клієнтів з altegioClientId: ${allClients.filter(c => c.altegioClientId).length}`);
    console.log(`[fix-online-consultations] Клієнтів з consultationBookingDate: ${allClients.filter(c => c.consultationBookingDate).length}`);
    console.log(`[fix-online-consultations] Клієнтів з consultationDate: ${allClients.filter(c => c.consultationDate).length}`);
    console.log(`[fix-online-consultations] Знайдено ${clientsToCheck.length} клієнтів для перевірки (мають altegioClientId і isOnlineConsultation = false або undefined)`);

    let updatedCount = 0;
    let checkedCount = 0;

    // Знаходимо клієнта "Юлія Кобра" для детальної діагностики
    const yuliaKobra = clientsToCheck.find(
      (c) => 
        c.instagramUsername === 'kobra_best' || 
        (c.firstName === 'Юлія' && c.lastName === 'Кобра') ||
        (c.firstName?.toLowerCase().includes('юлія') && c.lastName?.toLowerCase().includes('кобра'))
    );
    
    if (yuliaKobra) {
      console.log(`[fix-online-consultations] 🎯 Знайдено клієнта Юлія Кобра:`, {
        instagramUsername: yuliaKobra.instagramUsername,
        altegioClientId: yuliaKobra.altegioClientId,
        consultationBookingDate: yuliaKobra.consultationBookingDate,
        isOnlineConsultation: yuliaKobra.isOnlineConsultation,
      });
    } else {
      // Шукаємо серед усіх клієнтів
      const yuliaKobraAll = allClients.find(
        (c) => 
          c.instagramUsername === 'kobra_best' || 
          (c.firstName === 'Юлія' && c.lastName === 'Кобра') ||
          (c.firstName?.toLowerCase().includes('юлія') && c.lastName?.toLowerCase().includes('кобра'))
      );
      
      if (yuliaKobraAll) {
        console.log(`[fix-online-consultations] ⚠️ Знайдено клієнта Юлія Кобра, але він не в списку для перевірки:`, {
          instagramUsername: yuliaKobraAll.instagramUsername,
          altegioClientId: yuliaKobraAll.altegioClientId,
          isOnlineConsultation: yuliaKobraAll.isOnlineConsultation,
          hasAltegioId: !!yuliaKobraAll.altegioClientId,
          reason: yuliaKobraAll.isOnlineConsultation ? 'isOnlineConsultation = true' : (!yuliaKobraAll.altegioClientId ? 'немає altegioClientId' : 'непевна причина'),
        });
      } else {
        console.log(`[fix-online-consultations] ⚠️ Не знайдено клієнта Юлія Кобра (kobra_best) серед всіх клієнтів`);
      }
    }

    // Для кожного клієнта перевіряємо webhook'и
    for (const client of clientsToCheck) {
      checkedCount++;
      
      // Детальна діагностика для "Юлія Кобра"
      const isYuliaKobra = 
        client.instagramUsername === 'kobra_best' || 
        (client.firstName === 'Юлія' && client.lastName === 'Кобра') ||
        (client.firstName?.toLowerCase().includes('юлія') && client.lastName?.toLowerCase().includes('кобра'));

      try {
        // Отримуємо всі webhook'и для цього клієнта (як в client-webhooks)
        // Перевіряємо обидва джерела: webhook:log та records:log
        const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
        const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
        
        // Об'єднуємо обидва джерела
        const rawItems = [...rawItemsWebhook, ...rawItemsRecords];
        const events = rawItems
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
                  return parsed;
                }
              }
              
              // Конвертуємо events з records:log у формат webhook events (як в client-webhooks)
              if (parsed && parsed.visitId && !parsed.body) {
                return {
                  body: {
                    resource: 'record',
                    resource_id: parsed.visitId,
                    status: parsed.status || 'create',
                    data: {
                      datetime: parsed.datetime,
                      client: parsed.client ? { id: parsed.clientId || parsed.client.id } : { id: parsed.clientId },
                      staff: parsed.staff ? { name: parsed.staffName || parsed.staff.name } : { name: parsed.staffName },
                      services: parsed.services || (parsed.serviceName ? [{ title: parsed.serviceName }] : []),
                      attendance: parsed.attendance,
                      visit_attendance: parsed.visit_attendance,
                    },
                  },
                  receivedAt: parsed.receivedAt || parsed.datetime,
                  isFromRecordsLog: true,
                  originalRecord: parsed,
                };
              }
              
              return parsed;
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        
        // Фільтруємо record events для цього клієнта
        const clientRecords = events
          .filter((e: any) => {
            const isRecordEvent = e.body?.resource === 'record' || e.isFromRecordsLog;
            if (!isRecordEvent) return false;
            
            const data = e.body?.data || {};
            const originalRecord = e.originalRecord || {};
            
            const clientId = data.client?.id || originalRecord.clientId;
            const clientIdFromData = data.client_id || originalRecord.client_id;
            
            let foundClientId: number | null = null;
            if (clientId) {
              const parsed = parseInt(String(clientId), 10);
              if (!isNaN(parsed)) {
                foundClientId = parsed;
              }
            } else if (clientIdFromData) {
              const parsed = parseInt(String(clientIdFromData), 10);
              if (!isNaN(parsed)) {
                foundClientId = parsed;
              }
            }
            
            return foundClientId === client.altegioClientId;
          })
          .sort((a: any, b: any) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

        // Перевіряємо, чи є серед послуг "Онлайн-консультація"
        // Витягуємо services з body.data або originalRecord (як в client-webhooks)
        let foundOnlineConsultation = false;
        let allServices: string[] = [];
        for (const record of clientRecords) {
          const body = record.body || {};
          const data = body.data || {};
          const originalRecord = record.originalRecord || {};
          
          // Витягуємо services (як в client-webhooks)
          // Перевіряємо всі можливі місця, де можуть зберігатися послуги
          let services: any[] = [];
          if (Array.isArray(data.services) && data.services.length > 0) {
            services = data.services;
          } else if (data.service) {
            services = [data.service];
          } else if (originalRecord.data && originalRecord.data.services && Array.isArray(originalRecord.data.services)) {
            // Перевіряємо originalRecord.data.services
            services = originalRecord.data.services;
          } else if (originalRecord.data && originalRecord.data.service) {
            // Перевіряємо originalRecord.data.service
            services = [originalRecord.data.service];
          } else if (originalRecord.services && Array.isArray(originalRecord.services)) {
            services = originalRecord.services;
          } else if (originalRecord.serviceName) {
            services = [{ title: originalRecord.serviceName }];
          }
          
          if (services.length > 0) {
            allServices.push(...services.map((s: any) => s.title || s.name || '').filter(Boolean));
          }
          
          const consultationInfo = isConsultationService(services);
          
          // Детальне логування для першого клієнта з записами або для "Юлія Кобра"
          if ((checkedCount === 1 || isYuliaKobra) && !foundOnlineConsultation) {
            console.log(`[fix-online-consultations] 🔍 Перевірка послуг для ${client.instagramUsername}:`, {
              serviceCount: services.length,
              services: services.map((s: any) => ({
                title: s.title,
                name: s.name,
                raw: s,
              })),
              consultationInfo,
              allServicesString: services.map((s: any) => s.title || s.name || '').join(', '),
            });
          }
          
          if (consultationInfo.isConsultation && consultationInfo.isOnline) {
            foundOnlineConsultation = true;
            console.log(`[fix-online-consultations] ✅ Знайдено онлайн-консультацію для ${client.instagramUsername}:`, {
              services: services.map((s: any) => s.title || s.name),
              recordDate: record.receivedAt || record.datetime,
              consultationInfo,
            });
            break;
          }
        }
        
        // Логуємо перші 3 клієнтів для діагностики або "Юлія Кобра"
        if ((checkedCount <= 3 || isYuliaKobra) && clientRecords.length > 0) {
          const firstRecord = clientRecords[0];
          const body = firstRecord.body || {};
          const data = body.data || {};
          const originalRecord = firstRecord.originalRecord || {};
          
          let servicesFromRecord: any[] = [];
          if (Array.isArray(data.services) && data.services.length > 0) {
            servicesFromRecord = data.services;
          } else if (data.service) {
            servicesFromRecord = [data.service];
          } else if (originalRecord.services && Array.isArray(originalRecord.services)) {
            servicesFromRecord = originalRecord.services;
          } else if (originalRecord.serviceName) {
            servicesFromRecord = [{ title: originalRecord.serviceName }];
          }
          
          console.log(`[fix-online-consultations] 🔍 Діагностика для ${client.instagramUsername} (altegioClientId: ${client.altegioClientId}):`, {
            totalRecords: clientRecords.length,
            firstRecordBody: body,
            firstRecordData: data,
            firstRecordOriginalRecord: originalRecord,
            servicesFromRecord: servicesFromRecord.map((s: any) => ({
              title: s.title,
              name: s.name,
              raw: s,
            })),
            allUniqueServices: [...new Set(allServices)].slice(0, 10),
            consultationCheck: isConsultationService(servicesFromRecord),
          });
        }
        
        // Якщо знайшли записи, але не знайшли онлайн-консультацію, логуємо для першого клієнта або "Юлія Кобра"
        if ((checkedCount === 1 || isYuliaKobra) && clientRecords.length > 0 && !foundOnlineConsultation) {
          const clientName = isYuliaKobra ? 'Юлія Кобра' : client.instagramUsername;
          console.log(`[fix-online-consultations] ⚠️ Для ${clientName} (${client.instagramUsername}, altegioClientId: ${client.altegioClientId}) знайдено ${clientRecords.length} записів, але не знайдено онлайн-консультацію`);
          console.log(`[fix-online-consultations] Всі унікальні послуги з записів:`, [...new Set(allServices)]);
          
          // Перевіряємо перший запис детально
          if (clientRecords.length > 0) {
            const firstRecord = clientRecords[0];
            const body = firstRecord.body || {};
            const data = body.data || {};
            const originalRecord = firstRecord.originalRecord || {};
            
            console.log(`[fix-online-consultations] Перший запис детально:`, {
              hasBody: !!body,
              hasData: !!data,
              hasOriginalRecord: !!originalRecord,
              bodyKeys: Object.keys(body),
              dataKeys: Object.keys(data),
              originalRecordKeys: Object.keys(originalRecord),
              servicesInData: data.services,
              servicesInOriginal: originalRecord.services,
              serviceNameInOriginal: originalRecord.serviceName,
            });
          }
        }

        // Якщо знайшли онлайн-консультацію, оновлюємо клієнта
        if (foundOnlineConsultation) {
          const updated = {
            ...client,
            isOnlineConsultation: true,
            updatedAt: new Date().toISOString(),
          };

          await saveDirectClient(updated, 'fix-online-consultations', {
            altegioClientId: client.altegioClientId,
            instagramUsername: client.instagramUsername,
            reason: 'Оновлення isOnlineConsultation на основі webhook історії',
          });

          updatedCount++;
          console.log(
            `[fix-online-consultations] ✅ Оновлено клієнта ${client.instagramUsername} (${client.firstName} ${client.lastName || ''}) - встановлено isOnlineConsultation = true`
          );
        }
      } catch (err) {
        console.error(
          `[fix-online-consultations] ❌ Помилка при обробці клієнта ${client.instagramUsername}:`,
          err
        );
      }
    }

    return {
      success: true,
      checked: checkedCount,
      updated: updatedCount,
      totalClients: allClients.length,
      clientsWithAltegioId: allClients.filter(c => c.altegioClientId).length,
      clientsWithConsultationBookingDate: allClients.filter(c => c.consultationBookingDate).length,
      clientsWithConsultationDate: allClients.filter(c => c.consultationDate).length,
      message: `Перевірено ${checkedCount} клієнтів, оновлено ${updatedCount} записів`,
    };
  } catch (err: any) {
    console.error('[fix-online-consultations] ❌ Помилка:', err);
    throw err;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await fixOnlineConsultations();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[fix-online-consultations] ❌ Помилка:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await fixOnlineConsultations();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[fix-online-consultations] ❌ Помилка:', err);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: err?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
