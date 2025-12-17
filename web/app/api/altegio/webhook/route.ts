// web/app/api/altegio/webhook/route.ts
// Webhook endpoint для отримання сповіщень від Altegio API

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';
import {
  getActiveReminderRules,
  generateReminderJobId,
  calculateDueAt,
  type ReminderJob,
} from '@/lib/altegio/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Webhook endpoint для Altegio
 * Отримує сповіщення про події в Altegio (appointments, clients, etc.)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    console.log('[altegio/webhook] Received webhook:', {
      timestamp: new Date().toISOString(),
      bodyKeys: Object.keys(body),
      eventType: body.event || body.type || 'unknown',
    });

    // Зберігаємо подію в KV (тільки останні 50 штук) для діагностики
    try {
      const entry = {
        receivedAt: new Date().toISOString(),
        event: body.event || body.type || null,
        body,
      };
      const payload = JSON.stringify(entry);
      await kvWrite.lpush('altegio:webhook:log', payload);
      // залишаємо лише останні 50
      await kvWrite.ltrim('altegio:webhook:log', 0, 49);
    } catch (err) {
      console.warn('[altegio/webhook] Failed to persist webhook to KV:', err);
    }

    // Обробка подій по записах (record)
    if (body.resource === 'record') {
      const recordId = body.resource_id; // Це record_id, а не visit_id
      const visitId = body.data?.visit_id || body.resource_id; // Використовуємо data.visit_id якщо є
      const status = body.status; // 'create', 'update', 'delete'
      const data = body.data || {};

      console.log('[altegio/webhook] Processing record event:', {
        recordId,
        visitId,
        status,
        hasData: !!data,
        dataKeys: Object.keys(data),
        datetime: data.datetime,
        hasClient: !!data.client,
        clientKeys: data.client ? Object.keys(data.client) : [],
        hasServices: Array.isArray(data.services) && data.services.length > 0,
        servicesCount: Array.isArray(data.services) ? data.services.length : 0,
      });

      if (status === 'delete') {
        // Скасовуємо всі нагадування для видаленого запису
        try {
          const visitJobsKey = `altegio:reminder:byVisit:${visitId}`;
          const jobIdsRaw = await kvRead.getRaw(visitJobsKey);

          if (jobIdsRaw) {
            const jobIds: string[] = JSON.parse(jobIdsRaw);

            for (const jobId of jobIds) {
              const jobKey = `altegio:reminder:job:${jobId}`;
              const jobRaw = await kvRead.getRaw(jobKey);

              if (jobRaw) {
                const job: ReminderJob = JSON.parse(jobRaw);
                // Помічаємо як скасований
                job.status = 'canceled';
                job.updatedAt = Date.now();
                job.canceledAt = Date.now();
                await kvWrite.setRaw(jobKey, JSON.stringify(job));
              }
            }

            // Очищаємо індекс по visitId
            await kvWrite.setRaw(visitJobsKey, JSON.stringify([]));
          }

          console.log(
            `[altegio/webhook] ✅ Canceled reminders for deleted visit ${visitId}`,
          );
        } catch (err) {
          console.error(
            `[altegio/webhook] ❌ Failed to cancel reminders for visit ${visitId}:`,
            err,
          );
        }
      } else if (status === 'update' || status === 'create') {
        // Зберігаємо record event для статистики (навіть якщо в минулому)
        try {
          // В webhook data.services - це масив, беремо перший service
          const firstService = Array.isArray(data.services) && data.services.length > 0
            ? data.services[0]
            : data.service || null;

          const recordEvent = {
            visitId: visitId, // Використовуємо правильний visit_id
            recordId: recordId, // Також зберігаємо record_id для діагностики
            status,
            datetime: data.datetime,
            serviceId: firstService?.id || data.service_id,
            serviceName: firstService?.title || firstService?.name || data.service?.title || data.service?.name,
            staffId: data.staff?.id || data.staff_id,
            clientId: data.client?.id || data.client_id,
            companyId: data.company_id,
            receivedAt: new Date().toISOString(),
            data: {
              service: firstService || data.service,
              services: data.services, // Зберігаємо весь масив services
              staff: data.staff,
              client: data.client,
            },
          };
          const recordPayload = JSON.stringify(recordEvent);
          await kvWrite.lpush('altegio:records:log', recordPayload);
          // Зберігаємо останні 10000 записів для статистики
          await kvWrite.ltrim('altegio:records:log', 0, 9999);
          console.log(`[altegio/webhook] ✅ Saved record event for stats: visitId=${visitId}, recordId=${recordId}, serviceId=${recordEvent.serviceId}, serviceName=${recordEvent.serviceName}, datetime=${data.datetime}`);
        } catch (err) {
          console.warn('[altegio/webhook] Failed to save record event for stats:', err);
        }

        // Оновлення або створення запису
        try {
          const datetime = data.datetime; // ISO string, наприклад "2025-11-28T17:00:00+02:00"
          if (!datetime) {
            console.log(`[altegio/webhook] ⏭️ Skipping visit ${visitId} - no datetime`);
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'no_datetime',
            });
          }

          const visitAt = new Date(datetime).getTime();
          const now = Date.now();

          // Якщо запис вже в минулому - не створюємо нагадування
          if (visitAt <= now) {
            console.log(
              `[altegio/webhook] ⏭️ Skipping past visit ${visitId} (datetime: ${datetime})`,
            );
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'past_visit',
            });
          }

          // Правила нагадувань
          const rules = await getActiveReminderRules();

          const client = data.client || {};
          
          // Детальне логування для діагностики
          console.log('[altegio/webhook] Client data:', {
            clientId: client.id,
            clientName: client.display_name || client.name,
            hasCustomFields: !!client.custom_fields,
            customFieldsKeys: client.custom_fields ? Object.keys(client.custom_fields) : [],
            customFields: client.custom_fields,
          });

          // Шукаємо Instagram username в різних місцях
          let instagram =
            client.custom_fields?.['instagram-user-name'] ||
            client.custom_fields?.['instagram_username'] ||
            client.custom_fields?.['instagram'] ||
            null;

          // Якщо немає Instagram - не створюємо нагадування
          if (!instagram) {
            console.log(
              `[altegio/webhook] ⏭️ Skipping visit ${visitId} - no Instagram username`,
              {
                customFields: client.custom_fields,
                allClientKeys: Object.keys(client),
              },
            );
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'no_instagram',
            });
          }

          // ТЕСТОВИЙ РЕЖИМ: тільки для тестового клієнта
          const TEST_INSTAGRAM_USERNAME = 'mykolayyurashko';
          if (instagram.toLowerCase() !== TEST_INSTAGRAM_USERNAME.toLowerCase()) {
            console.log(
              `[altegio/webhook] ⏭️ Skipping visit ${visitId} - not test client (instagram: ${instagram})`,
            );
            return NextResponse.json({
              ok: true,
              received: true,
              skipped: 'not_test_client',
            });
          }

          const visitJobsKey = `altegio:reminder:byVisit:${visitId}`;
          const existingJobIdsRaw = await kvRead.getRaw(visitJobsKey);
          const existingJobIds: string[] = existingJobIdsRaw
            ? JSON.parse(existingJobIdsRaw)
            : [];

          const newJobIds: string[] = [];

          // Для кожного правила створюємо/оновлюємо job
          console.log(`[altegio/webhook] Processing ${rules.length} rules for visit ${visitId}`, {
            datetime,
            visitAt: new Date(visitAt).toISOString(),
            now: new Date(now).toISOString(),
            daysUntilVisit: Math.round((visitAt - now) / (24 * 3600_000)),
          });

          for (const rule of rules) {
            const dueAt = calculateDueAt(datetime, rule.daysBefore);

            console.log(`[altegio/webhook] Rule ${rule.id} (${rule.daysBefore} days before):`, {
              dueAt: new Date(dueAt).toISOString(),
              now: new Date(now).toISOString(),
              visitAt: new Date(visitAt).toISOString(),
              isPast: dueAt <= now,
              diffMs: dueAt - now,
              diffHours: Math.round((dueAt - now) / (3600_000)),
            });

            // Якщо час вже пройшов - пропускаємо (щоб не спамити запізнілим)
            if (dueAt <= now) {
              console.log(
                `[altegio/webhook] ⏭️ Skipping rule ${rule.id} for visit ${visitId} - dueAt in past`,
                {
                  dueAt: new Date(dueAt).toISOString(),
                  now: new Date(now).toISOString(),
                  visitAt: new Date(visitAt).toISOString(),
                  daysBefore: rule.daysBefore,
                  diffMs: dueAt - now,
                },
              );
              continue;
            }

            const jobId = generateReminderJobId(visitId, rule.id);
            const jobKey = `altegio:reminder:job:${jobId}`;

            // Перевіряємо, чи вже є такий job
            const existingJobRaw = await kvRead.getRaw(jobKey);
            let job: ReminderJob;

            if (existingJobRaw) {
              // Оновлюємо існуючий job (наприклад, якщо перенесли дату)
              job = JSON.parse(existingJobRaw);
              job.datetime = datetime;
              job.dueAt = dueAt;
              job.updatedAt = Date.now();
              // Якщо job був canceled - відновлюємо його
              if (job.status === 'canceled') {
                job.status = 'pending';
                delete job.canceledAt;
              }
            } else {
              // Створюємо новий job
              job = {
                id: jobId,
                ruleId: rule.id,
                visitId: visitId,
                companyId: data.company_id || body.company_id || 0,
                clientId: client.id || 0,
                instagram: instagram,
                datetime: datetime,
                dueAt: dueAt,
                payload: {
                  clientName:
                    client.display_name || client.name || 'Клієнт',
                  phone: client.phone || null,
                  email: client.email || null,
                  serviceTitle: data.services?.[0]?.title || null,
                  staffName: data.staff?.name || null,
                },
                status: 'pending',
                attempts: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
            }

            // Зберігаємо job
            await kvWrite.setRaw(jobKey, JSON.stringify(job));
            newJobIds.push(jobId);

            // Додаємо в індекс для швидкого пошуку
            const indexKey = 'altegio:reminder:index';
            const indexRaw = await kvRead.getRaw(indexKey);
            let index: string[] = [];
            
            if (indexRaw) {
              try {
                const parsed = JSON.parse(indexRaw);
                if (Array.isArray(parsed)) {
                  index = parsed;
                } else {
                  console.warn('[altegio/webhook] Index is not an array, resetting:', typeof parsed, parsed);
                  // Скидаємо до порожнього масиву, якщо не масив
                  index = [];
                  await kvWrite.setRaw(indexKey, JSON.stringify(index));
                }
              } catch (err) {
                console.warn('[altegio/webhook] Failed to parse index:', err);
                // Скидаємо до порожнього масиву при помилці парсингу
                index = [];
                await kvWrite.setRaw(indexKey, JSON.stringify(index));
              }
            }
            
            if (!index.includes(jobId)) {
              index.push(jobId);
              await kvWrite.setRaw(indexKey, JSON.stringify(index));
              console.log(`[altegio/webhook] Added job ${jobId} to index, total: ${index.length}`);
            } else {
              console.log(`[altegio/webhook] Job ${jobId} already in index`);
            }
          }

          // Оновлюємо індекс по visitId
          await kvWrite.setRaw(visitJobsKey, JSON.stringify(newJobIds));

          console.log(
            `[altegio/webhook] ✅ Created/updated ${newJobIds.length} reminders for visit ${visitId}`,
          );
        } catch (err) {
          console.error(
            `[altegio/webhook] ❌ Failed to process ${status} for visit ${visitId}:`,
            err,
          );
        }
      }
    }

    // Повертаємо успішну відповідь
    return NextResponse.json({
      ok: true,
      received: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[altegio/webhook] Error processing webhook:', error);
    
    // Важливо: повертаємо 200 OK навіть при помилці,
    // щоб Altegio не намагався повторно надсилати webhook
    return NextResponse.json({ 
      ok: false, 
      error: error instanceof Error ? error.message : String(error),
    }, { status: 200 });
  }
}

// GET для перевірки, що endpoint працює
export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;

    const rawItems = await kvRead.lrange('altegio:webhook:log', 0, limit - 1);
    const events = rawItems
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return { raw };
        }
      })
      .filter(Boolean);

    // Шукаємо останні події по record
    const recordEvents = events
      .filter((e: any) => e.body?.resource === 'record')
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        status: e.body?.status,
        visitId: e.body?.resource_id,
        datetime: e.body?.data?.datetime,
        serviceId: e.body?.data?.service?.id || e.body?.data?.service_id,
        serviceName: e.body?.data?.service?.title || e.body?.data?.service?.name || 'Невідома послуга',
        staffId: e.body?.data?.staff?.id || e.body?.data?.staff_id,
        staffName: e.body?.data?.staff?.name || e.body?.data?.staff?.display_name || 'Невідомий майстер',
        clientId: e.body?.data?.client?.id,
        clientName: e.body?.data?.client?.display_name || e.body?.data?.client?.name,
        fullBody: e.body,
      }));

    // Отримуємо record events з records log (які ми зберігаємо для статистики)
    let savedRecords: any[] = [];
    try {
      const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, limit - 1);
      savedRecords = recordsLogRaw
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
        .filter((r) => r && r.visitId && r.datetime);
    } catch (err) {
      console.warn('[webhook GET] Failed to read records log:', err);
    }

    // Знаходимо останній record event
    const lastRecordEvent = recordEvents.length > 0
      ? recordEvents[0]
      : savedRecords.length > 0
        ? {
            visitId: savedRecords[0].visitId,
            datetime: savedRecords[0].datetime,
            serviceId: savedRecords[0].serviceId,
            serviceName: savedRecords[0].serviceName,
            staffId: savedRecords[0].staffId,
            receivedAt: savedRecords[0].receivedAt,
            status: 'saved',
          }
        : null;

    return NextResponse.json({
      ok: true,
      message: 'Altegio webhook endpoint is active',
      timestamp: new Date().toISOString(),
      eventsCount: events.length,
      recordEventsCount: recordEvents.length,
      savedRecordsCount: savedRecords.length,
      lastRecordEvent: lastRecordEvent,
      lastRecordEvents: recordEvents.slice(0, 10),
      savedRecords: savedRecords.slice(0, 10),
      allEvents: events.slice(0, 5), // Перші 5 для діагностики
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Failed to read webhook log',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
