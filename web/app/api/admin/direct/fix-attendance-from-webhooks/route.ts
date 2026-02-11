// API endpoint для переобробки вебхуків з KV і встановлення consultationAttended/paidServiceAttended
// на основі attendance з вебхуків

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { getAllDirectClients, saveDirectClient } from '@/lib/direct-store';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  
  const tokenParam = req.nextUrl.searchParams.get('token');
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;
  
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

// Функція для перевірки, чи є консультація (включаючи онлайн)
function isConsultationService(serviceTitle: string): { isConsultation: boolean; isOnline: boolean } {
  if (!serviceTitle) return { isConsultation: false, isOnline: false };
  
  const lower = serviceTitle.toLowerCase().trim();
  const isOnline = lower.includes('онлайн-консультаці') || lower.includes('online-consultation') || lower.includes('онлайн консультаці');
  const isConsultation = isOnline || 
    lower.includes('консультаці') || 
    lower.includes('consultation') ||
    lower === 'консультація' ||
    lower === 'consultation';
  
  return { isConsultation, isOnline };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[fix-attendance-from-webhooks] Starting webhook reprocessing...');
    
    // Отримуємо всі клієнтів
    const allClients = await getAllDirectClients();
    console.log(`[fix-attendance-from-webhooks] Found ${allClients.length} clients`);
    
    // Отримуємо всі вебхуки з KV
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 9999);
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItems = [...rawItemsWebhook, ...rawItemsRecords];
    
    console.log(`[fix-attendance-from-webhooks] Found ${rawItems.length} webhook records`);
    
    // Парсимо вебхуки
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
          
          // Конвертуємо events з records:log у формат webhook events
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
                  attendance: parsed.attendance || parsed.visit_attendance,
                },
              },
              receivedAt: parsed.receivedAt || parsed.datetime,
              originalRecord: parsed,
            };
          }
          
          return parsed;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    
    // Групуємо вебхуки по клієнтах
    const clientsByAltegioId = new Map<number, typeof allClients[0]>();
    allClients.forEach(client => {
      if (client.altegioClientId) {
        clientsByAltegioId.set(client.altegioClientId, client);
      }
    });
    
    const updated: string[] = [];
    let consultationUpdated = 0;
    let paidServiceUpdated = 0;
    
    // Обробляємо вебхуки для кожного клієнта
    for (const event of events) {
      try {
        const body = event.body || event;
        if (body.resource !== 'record') continue;
        
        const data = body.data || {};
        const clientId = data.client?.id;
        if (!clientId) continue;
        
        const client = clientsByAltegioId.get(clientId);
        if (!client) continue;
        
        const datetime = data.datetime;
        if (!datetime) continue;
        
        const attendance = data.attendance;
        if (attendance === undefined || attendance === null) continue; // Пропускаємо, якщо attendance не встановлено
        
        const services = Array.isArray(data.services) ? data.services : [];
        
        // Перевіряємо, чи є консультація
        let hasConsultation = false;
        let isOnline = false;
        
        for (const service of services) {
          const serviceTitle = service.title || service.name || '';
          const consultationInfo = isConsultationService(serviceTitle);
          if (consultationInfo.isConsultation) {
            hasConsultation = true;
            isOnline = consultationInfo.isOnline;
            break;
          }
        }
        
        // Перевіряємо, чи є платна послуга (нарощування або інші, але не консультація)
        const hasHairExtension = services.some((s: any) => {
          const title = (s.title || s.name || '').toLowerCase();
          return title.includes('нарощування') || title.includes('нарощування волосся') || title.includes('hair extension');
        });
        
        const hasPaidService = !hasConsultation && (hasHairExtension || services.length > 0);
        
        // Оновлюємо consultationAttended для консультацій
        if (hasConsultation && client.consultationBookingDate) {
          const consultationDate = new Date(client.consultationBookingDate);
          const eventDate = new Date(datetime);
          
          // Перевіряємо, чи це той самий день або близька дата
          const sameDay = consultationDate.toISOString().split('T')[0] === eventDate.toISOString().split('T')[0];
          
          if (sameDay || Math.abs(consultationDate.getTime() - eventDate.getTime()) < 24 * 60 * 60 * 1000) {
            let needsUpdate = false;
            const updates: Partial<typeof client> = {};
            
            if ((attendance === 1 || attendance === 2) && client.consultationAttended !== true) {
              updates.consultationAttended = true;
              needsUpdate = true;
            } else if (attendance === -1 && client.consultationAttended !== false) {
              updates.consultationAttended = false;
              needsUpdate = true;
            }
            
            if (needsUpdate) {
              const updatedClient = {
                ...client,
                ...updates,
                updatedAt: new Date().toISOString(),
              };
              
              await saveDirectClient(updatedClient, 'fix-attendance-from-webhooks', {
                altegioClientId: clientId,
                datetime,
                attendance,
                reason: 'consultation attendance update from webhook history',
              }, { touchUpdatedAt: false });
              
              consultationUpdated++;
              updated.push(`${client.instagramUsername || client.firstName}: consultationAttended = ${updates.consultationAttended}`);
              console.log(`[fix-attendance-from-webhooks] Updated consultationAttended for ${client.instagramUsername || client.firstName}: ${updates.consultationAttended}`);
            }
          }
        }
        
        // Оновлюємо paidServiceAttended для платних послуг
        if (hasPaidService && client.paidServiceDate) {
          const paidServiceDate = new Date(client.paidServiceDate);
          const eventDate = new Date(datetime);
          
          const sameDay = paidServiceDate.toISOString().split('T')[0] === eventDate.toISOString().split('T')[0];
          
          if (sameDay || Math.abs(paidServiceDate.getTime() - eventDate.getTime()) < 24 * 60 * 60 * 1000) {
            let needsUpdate = false;
            const updates: Partial<typeof client> = {};
            
            if ((attendance === 1 || attendance === 2) && client.paidServiceAttended !== true) {
              updates.paidServiceAttended = true;
              needsUpdate = true;
            } else if (attendance === -1 && client.paidServiceAttended !== false) {
              updates.paidServiceAttended = false;
              needsUpdate = true;
            }
            
            if (needsUpdate) {
              const updatedClient = {
                ...client,
                ...updates,
                updatedAt: new Date().toISOString(),
              };
              
              await saveDirectClient(updatedClient, 'fix-attendance-from-webhooks', {
                altegioClientId: clientId,
                datetime,
                attendance,
                reason: 'paid service attendance update from webhook history',
              }, { touchUpdatedAt: false });
              
              paidServiceUpdated++;
              updated.push(`${client.instagramUsername || client.firstName}: paidServiceAttended = ${updates.paidServiceAttended}`);
              console.log(`[fix-attendance-from-webhooks] Updated paidServiceAttended for ${client.instagramUsername || client.firstName}: ${updates.paidServiceAttended}`);
            }
          }
        }
      } catch (err) {
        console.error('[fix-attendance-from-webhooks] Error processing event:', err);
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Вебхуки переоброблено успішно',
      consultationUpdated,
      paidServiceUpdated,
      totalUpdated: updated.length,
      updated: updated.slice(0, 50), // Перші 50 для перевірки
    });
  } catch (error: any) {
    console.error('[fix-attendance-from-webhooks] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Помилка при переобробці вебхуків',
      },
      { status: 500 }
    );
  }
}
