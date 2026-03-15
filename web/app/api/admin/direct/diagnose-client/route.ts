// web/app/api/admin/direct/diagnose-client/route.ts
// Діагностика конкретної клієнтки для виявлення проблеми з оновленням стану

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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
 * POST - діагностика конкретної клієнтки
 * Body: { instagramUsername?: string, fullName?: string, altegioClientId?: number }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { instagramUsername, fullName, altegioClientId } = body;

    if (!instagramUsername && !fullName && !altegioClientId) {
      return NextResponse.json(
        { ok: false, error: 'Provide instagramUsername, fullName, or altegioClientId' },
        { status: 400 }
      );
    }

    console.log('[direct/diagnose-client] Starting diagnosis...', { instagramUsername, fullName, altegioClientId });

    // 1. Знаходимо клієнта в Direct Manager
    const allClients = await getAllDirectClients();
    let directClient = null;

    if (altegioClientId) {
      directClient = allClients.find((c) => c.altegioClientId === parseInt(String(altegioClientId), 10));
    } else if (instagramUsername) {
      const normalized = normalizeInstagram(instagramUsername);
      if (normalized) {
        directClient = allClients.find((c) => {
          const normalizedClient = normalizeInstagram(c.instagramUsername);
          return normalizedClient === normalized;
        });
      }
    } else if (fullName) {
      const nameParts = fullName.toLowerCase().trim().split(/\s+/);
      directClient = allClients.find((c) => {
        const clientFirstName = c.firstName?.toLowerCase() || '';
        const clientLastName = c.lastName?.toLowerCase() || '';
        const clientFullName = [clientFirstName, clientLastName].filter(Boolean).join(' ');
        return nameParts.every((part) => clientFullName.includes(part));
      });
    }

    const diagnosis: any = {
      directClient: directClient
        ? {
            id: directClient.id,
            instagramUsername: directClient.instagramUsername,
            firstName: directClient.firstName,
            lastName: directClient.lastName,
            fullName: [directClient.firstName, directClient.lastName].filter(Boolean).join(' '),
            state: directClient.state,
            altegioClientId: directClient.altegioClientId,
            source: directClient.source,
            createdAt: directClient.createdAt,
            updatedAt: directClient.updatedAt,
          }
        : null,
      issues: [],
      recommendations: [],
    };

    // 2. Перевіряємо, чи є altegioClientId
    if (directClient) {
      if (!directClient.altegioClientId) {
        diagnosis.issues.push('❌ Клієнтка не має altegioClientId - вебхук не може знайти її для оновлення стану');
        diagnosis.recommendations.push('Потрібно синхронізувати клієнтку з Altegio, щоб встановити altegioClientId');
      } else {
        diagnosis.info = `✅ Клієнтка має altegioClientId: ${directClient.altegioClientId}`;
      }
      
      // Перевіряємо, чи є запис на платну послугу
      if (!directClient.paidServiceDate && !directClient.consultationBookingDate) {
        diagnosis.issues.push('⚠️ У клієнтки немає запису на послугу (ні на платну, ні на консультацію)');
      } else if (directClient.paidServiceDate) {
        diagnosis.info = `${diagnosis.info || ''}\n✅ Запис на платну послугу: ${new Date(directClient.paidServiceDate).toLocaleString('uk-UA')}`;
      }
    } else {
      diagnosis.issues.push('❌ Клієнтка не знайдена в Direct Manager');
      diagnosis.recommendations.push('Перевірте, чи правильно вказано Instagram username або ім\'я');
    }

    // 3. Перевіряємо записи в Altegio records log
    if (directClient?.altegioClientId) {
      const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
      const records = recordsLogRaw
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
        .filter((r) => r && r.clientId === directClient.altegioClientId && r.data && Array.isArray(r.data.services));

      diagnosis.records = {
        total: records.length,
        withConsultation: records.filter((r) =>
          r.data.services.some((s: any) => s.title && /консультація/i.test(s.title))
        ).length,
        withHairExtension: records.filter((r) =>
          r.data.services.some((s: any) => s.title && /нарощування/i.test(s.title))
        ).length,
        latest: records
          .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
          .slice(0, 3)
          .map((r) => ({
            receivedAt: r.receivedAt,
            status: r.status,
            services: r.data.services.map((s: any) => s.title),
            hasConsultation: r.data.services.some((s: any) => s.title && /консультація/i.test(s.title)),
            hasHairExtension: r.data.services.some((s: any) => s.title && /нарощування/i.test(s.title)),
          })),
      };

      // Перевіряємо, чи є записи з нарощуванням, але немає paidServiceDate
      const hasHairExtensionRecords = records.some((r) =>
        r.data.services.some((s: any) => s.title && /нарощування/i.test(s.title))
      );
      if (hasHairExtensionRecords && !directClient.paidServiceDate) {
        diagnosis.issues.push('⚠️ Знайдено записи з нарощуванням в вебхуках, але paidServiceDate не встановлено');
        diagnosis.recommendations.push('Можливо, вебхук не обробився правильно. Перевірте логи вебхуків або запустіть синхронізацію paidServiceDate.');
      }
      
      if (records.length === 0) {
        diagnosis.issues.push('❌ Не знайдено записів в Altegio records log для цієї клієнтки');
        diagnosis.recommendations.push('Можливо, вебхук не отримував події для цієї клієнтки');
      } else {
        const hasConsultationRecord = records.some((r) =>
          r.data.services.some((s: any) => s.title && /консультація/i.test(s.title))
        );
        if (hasConsultationRecord && directClient.state !== 'consultation') {
          diagnosis.issues.push(
            `❌ Знайдено записи з "Консультація", але стан клієнтки: "${directClient.state || 'не встановлено'}"`
          );
          diagnosis.recommendations.push('Натисніть кнопку "🔄 Оновити стани" для оновлення стану всіх клієнтів');
        }
      }
    }

    // 4. Перевіряємо вебхуки (перевіряємо обидва джерела: webhook:log та records:log)
    const webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const recordsLogRawForWebhooks = await kvRead.lrange('altegio:records:log', 0, 999);
    
    // Об'єднуємо обидва джерела
    const allWebhookItems = [...webhookLogRaw, ...recordsLogRawForWebhooks];
    
    const webhooks = allWebhookItems
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
          
          // Конвертуємо events з records:log у формат webhook events (як в client-webhooks/route.ts)
          if (parsed && parsed.visitId && !parsed.body) {
            // Це event з records:log - конвертуємо в формат webhook
            return {
              body: {
                resource: 'record',
                resource_id: parsed.visitId,
                status: parsed.status || 'create',
                data: {
                  datetime: parsed.datetime,
                  client: parsed.client ? { id: parsed.clientId || parsed.client.id } : { id: parsed.clientId },
                  staff: parsed.staff ? { name: parsed.staffName || parsed.staff.name } : { name: parsed.staffName },
                  services: parsed.services || parsed.data?.services || [],
                  attendance: parsed.attendance || parsed.visit_attendance,
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
      .filter((w) => {
        if (!w) return false;
        
        // Для конвертованих events з records:log
        if (w.isFromRecordsLog && w.originalRecord) {
          const clientId = w.originalRecord.clientId || w.body?.data?.client?.id;
          if (directClient?.altegioClientId && clientId) {
            return parseInt(String(clientId), 10) === directClient.altegioClientId;
          }
          return false;
        }
        
        // Для звичайних webhook events
        if (!w.body) return false;
        if (directClient?.altegioClientId) {
          return (
            (w.body.resource === 'record' && w.body.data?.client?.id === directClient.altegioClientId) ||
            (w.body.resource === 'client' && w.body.resource_id === directClient.altegioClientId)
          );
        }
        return false;
      });

    diagnosis.webhooks = {
      total: webhooks.length,
      records: webhooks.filter((w) => w.body?.resource === 'record').length,
      clients: webhooks.filter((w) => w.body?.resource === 'client').length,
      latest: webhooks
        .sort((a, b) => new Date(b.receivedAt || b.timestamp || 0).getTime() - new Date(a.receivedAt || a.timestamp || 0).getTime())
        .slice(0, 5)
        .map((w) => ({
          receivedAt: w.receivedAt || w.timestamp,
          resource: w.body?.resource,
          status: w.body?.status,
          resourceId: w.body?.resource_id,
          datetime: w.body?.data?.datetime || w.originalRecord?.datetime,
          hasServices: Array.isArray(w.body?.data?.services),
          services: w.body?.data?.services?.map((s: any) => s.title) || [],
          hasHairExtension: w.body?.data?.services?.some((s: any) => /нарощування/i.test(s.title || s.name || '')) || false,
          hasConsultation: w.body?.data?.services?.some((s: any) => /консультаці/i.test(s.title || s.name || '')) || false,
        })),
    };

    if (directClient?.altegioClientId && webhooks.length === 0) {
      diagnosis.issues.push('❌ Не знайдено вебхуків для цієї клієнтки');
      diagnosis.recommendations.push('Можливо, вебхуки не надсилалися або не зберігалися для цієї клієнтки');
    }

    return NextResponse.json({
      ok: true,
      diagnosis,
    });
  } catch (error) {
    console.error('[direct/diagnose-client] POST error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

