// web/app/api/altegio/reminders/debug/route.ts
// Діагностичний endpoint для перевірки нагадувань

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import type { ReminderJob } from '@/lib/altegio/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    // 1. Перевіряємо останні webhook події
    let webhookLogRaw: string[] = [];
    try {
      webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 9);
    } catch (err) {
      console.error('[altegio/reminders/debug] Failed to read webhook log:', err);
      // Продовжуємо з порожнім масивом
    }
    const webhookEvents = webhookLogRaw
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          // Якщо це об'єкт з полем value (як в GET endpoint), розпарсимо value
          if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return { raw };
        }
      })
      .filter(Boolean);

    // 2. Перевіряємо індекс job'ів
    const indexKey = 'altegio:reminder:index';
    const indexRaw = await kvRead.getRaw(indexKey);
    let jobIds: string[] = [];
    if (indexRaw) {
      try {
        // kvGetRaw може повернути об'єкт { value: '...' } або рядок
        let parsed: any;
        if (typeof indexRaw === 'string') {
          try {
            parsed = JSON.parse(indexRaw);
          } catch {
            parsed = indexRaw;
          }
        } else {
          parsed = indexRaw;
        }
        
        // Якщо це об'єкт з полем value, витягуємо значення
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const candidate = parsed.value ?? parsed.result ?? parsed.data;
          if (candidate !== undefined) {
            if (typeof candidate === 'string') {
              try {
                parsed = JSON.parse(candidate);
              } catch {
                parsed = candidate;
              }
            } else {
              parsed = candidate;
            }
          }
        }
        
        if (Array.isArray(parsed)) {
          jobIds = parsed;
        }
      } catch (err) {
        console.warn('[altegio/reminders/debug] Failed to parse index:', err);
      }
    }

    // 3. Завантажуємо всі job'и
    const jobs: ReminderJob[] = [];
    const missingJobs: string[] = [];
    for (const jobId of jobIds) {
      const jobKey = `altegio:reminder:job:${jobId}`;
      const jobRaw = await kvRead.getRaw(jobKey);
      if (jobRaw) {
        try {
          jobs.push(JSON.parse(jobRaw));
        } catch (err) {
          console.warn(`[altegio/reminders/debug] Failed to parse job ${jobId}:`, err);
        }
      } else {
        missingJobs.push(jobId);
      }
    }

    // 4. Аналізуємо всі webhook події
    const allEventsAnalysis = webhookEvents.map((e: any) => {
      try {
        // Обробляємо різні формати: може бути напряму об'єкт або обгорнутий в value
        let eventBody = e.body;
        let receivedAt = e.receivedAt;
        
        // Якщо body немає, але є value (як в GET endpoint)
        if (!eventBody && e.value) {
          if (typeof e.value === 'string') {
            try {
              const parsed = JSON.parse(e.value);
              eventBody = parsed.body;
              receivedAt = parsed.receivedAt || receivedAt;
            } catch {
              // Якщо не вдалося розпарсити, залишаємо як є
            }
          } else if (typeof e.value === 'object' && e.value.body) {
            eventBody = e.value.body;
            receivedAt = e.value.receivedAt || receivedAt;
          }
        }
        
        return {
          receivedAt: receivedAt || new Date().toISOString(),
          resource: eventBody?.resource,
          resource_id: eventBody?.resource_id,
          status: eventBody?.status,
          event: eventBody?.event || e.event,
          type: eventBody?.type || e.type,
          bodyKeys: eventBody ? Object.keys(eventBody) : [],
          // Для record подій
          datetime: eventBody?.data?.datetime,
          clientId: eventBody?.data?.client?.id,
          clientName: eventBody?.data?.client?.display_name || eventBody?.data?.client?.name,
          instagram: eventBody?.data?.client?.custom_fields?.['instagram-user-name'],
          // Повний body для діагностики
          fullBody: eventBody || e,
        };
      } catch (err) {
        console.warn('[altegio/reminders/debug] Failed to analyze event:', err);
        return {
          receivedAt: new Date().toISOString(),
          resource: null,
          resource_id: null,
          status: null,
          event: null,
          type: null,
          bodyKeys: [],
          datetime: null,
          clientId: null,
          clientName: null,
          instagram: null,
          fullBody: e,
        };
      }
    });

    // 5. Шукаємо останні події по record
    const recordEvents = allEventsAnalysis.filter((e: any) => e.resource === 'record');

    // 6. Перевіряємо job'и по visitId
    const jobsByVisit = new Map<number, ReminderJob[]>();
    for (const job of jobs) {
      if (!jobsByVisit.has(job.visitId)) {
        jobsByVisit.set(job.visitId, []);
      }
      jobsByVisit.get(job.visitId)!.push(job);
    }

    // 7. Групуємо події по resource
    const eventsByResource = new Map<string, number>();
    for (const event of allEventsAnalysis) {
      const resource = event.resource || 'unknown';
      eventsByResource.set(resource, (eventsByResource.get(resource) || 0) + 1);
    }

    return NextResponse.json({
      ok: true,
      diagnostics: {
        webhookEvents: {
          total: webhookEvents.length,
          recordEvents: recordEvents.length,
          lastRecordEvents: recordEvents.slice(0, 5),
          eventsByResource: Array.from(eventsByResource.entries()).map(([resource, count]) => ({
            resource,
            count,
          })),
          lastAllEvents: allEventsAnalysis.slice(0, 10), // Останні 10 подій для діагностики
        },
        jobs: {
          total: jobs.length,
          indexTotal: jobIds.length,
          missingJobs: missingJobs.length,
          missingJobIds: missingJobs.slice(0, 10), // Перші 10 для діагностики
          pending: jobs.filter((j) => j.status === 'pending').length,
          sent: jobs.filter((j) => j.status === 'sent').length,
          failed: jobs.filter((j) => j.status === 'failed').length,
          canceled: jobs.filter((j) => j.status === 'canceled').length,
          byVisit: Array.from(jobsByVisit.entries()).map(([visitId, jobList]) => ({
            visitId,
            count: jobList.length,
            jobs: jobList.map((j) => ({
              id: j.id,
              ruleId: j.ruleId,
              status: j.status,
              instagram: j.instagram,
              datetime: j.datetime,
              dueAt: j.dueAt,
              dueAtFormatted: new Date(j.dueAt).toLocaleString('uk-UA'),
            })),
          })),
        },
        allJobs: jobs.map((j) => ({
          id: j.id,
          visitId: j.visitId,
          ruleId: j.ruleId,
          status: j.status,
          instagram: j.instagram,
          clientName: j.payload.clientName,
          datetime: j.datetime,
          dueAt: j.dueAt,
          dueAtFormatted: new Date(j.dueAt).toLocaleString('uk-UA'),
          createdAt: new Date(j.createdAt).toLocaleString('uk-UA'),
        })),
      },
    });
  } catch (error) {
    console.error('[altegio/reminders/debug] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

