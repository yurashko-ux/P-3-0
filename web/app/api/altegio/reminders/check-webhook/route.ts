// web/app/api/altegio/reminders/check-webhook/route.ts
// Endpoint для перевірки останніх webhook подій та створення job'ів вручну

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

export async function GET(req: NextRequest) {
  try {
    // Отримуємо останні webhook події
    const webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 19);
    const webhookEvents = webhookLogRaw
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
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

    // Шукаємо останні події по record
    const recordEvents = webhookEvents
      .filter((e: any) => e.body?.resource === 'record')
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        status: e.body?.status,
        visitId: e.body?.resource_id,
        datetime: e.body?.data?.datetime,
        clientId: e.body?.data?.client?.id,
        clientName: e.body?.data?.client?.display_name || e.body?.data?.client?.name,
        instagram: e.body?.data?.client?.custom_fields?.['instagram-user-name'],
        fullBody: e.body,
      }));

    return NextResponse.json({
      ok: true,
      totalEvents: webhookEvents.length,
      recordEvents: recordEvents.length,
      lastRecordEvents: recordEvents.slice(0, 10),
    });
  } catch (error) {
    console.error('[check-webhook] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { visitId, datetime, instagram, clientName, companyId, clientId } = body;

    if (!visitId || !datetime || !instagram) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Missing required fields: visitId, datetime, instagram',
        },
        { status: 400 },
      );
    }

    const visitAt = new Date(datetime).getTime();
    const now = Date.now();

    if (visitAt <= now) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Visit datetime must be in the future',
        },
        { status: 400 },
      );
    }

    const rules = await getActiveReminderRules();
    const visitJobsKey = `altegio:reminder:byVisit:${visitId}`;
    const newJobIds: string[] = [];

    console.log(`[check-webhook] Creating jobs for visit ${visitId}`, {
      datetime,
      visitAt: new Date(visitAt).toISOString(),
      now: new Date(now).toISOString(),
      daysUntilVisit: Math.round((visitAt - now) / (24 * 3600_000)),
    });

    for (const rule of rules) {
      const dueAt = calculateDueAt(datetime, rule.daysBefore);

      console.log(`[check-webhook] Rule ${rule.id} (${rule.daysBefore} days before):`, {
        dueAt: new Date(dueAt).toISOString(),
        now: new Date(now).toISOString(),
        visitAt: new Date(visitAt).toISOString(),
        isPast: dueAt <= now,
        diffMs: dueAt - now,
        diffHours: Math.round((dueAt - now) / (3600_000)),
      });

      if (dueAt <= now) {
        console.log(`[check-webhook] ⏭️ Skipping rule ${rule.id} - dueAt in past`);
        continue;
      }

      const jobId = generateReminderJobId(visitId, rule.id);
      const jobKey = `altegio:reminder:job:${jobId}`;

      // Перевіряємо, чи вже є такий job
      const existingJobRaw = await kvRead.getRaw(jobKey);
      let job: ReminderJob;

      if (existingJobRaw) {
        // Оновлюємо існуючий job
        let jobData: any;
        if (typeof existingJobRaw === 'string') {
          try {
            jobData = JSON.parse(existingJobRaw);
          } catch {
            jobData = existingJobRaw;
          }
        } else {
          jobData = existingJobRaw;
        }
        
        // Якщо це об'єкт з полем value, витягуємо значення
        if (jobData && typeof jobData === 'object' && !Array.isArray(jobData)) {
          const candidate = jobData.value ?? jobData.result ?? jobData.data;
          if (candidate !== undefined) {
            if (typeof candidate === 'string') {
              try {
                jobData = JSON.parse(candidate);
              } catch {
                jobData = candidate;
              }
            } else {
              jobData = candidate;
            }
          }
        }
        
        // Якщо все ще рядок, пробуємо парсити
        if (typeof jobData === 'string') {
          try {
            jobData = JSON.parse(jobData);
          } catch (err) {
            console.warn(`[check-webhook] Failed to parse existing job ${jobId} as JSON:`, err);
            jobData = null;
          }
        }
        
        if (jobData && typeof jobData === 'object' && 'id' in jobData) {
          job = jobData as ReminderJob;
          job.datetime = datetime;
          job.dueAt = dueAt;
          job.updatedAt = Date.now();
          if (job.status === 'canceled') {
            job.status = 'pending';
            delete job.canceledAt;
          }
        } else {
          // Якщо не вдалося розпарсити, створюємо новий
          job = {
            id: jobId,
            ruleId: rule.id,
            visitId: visitId,
            companyId: companyId || 1169323,
            clientId: clientId || 0,
            instagram: instagram,
            datetime: datetime,
            dueAt: dueAt,
            payload: {
              clientName: clientName || 'Тестовий клієнт',
              phone: null,
              email: null,
              serviceTitle: null,
              staffName: null,
            },
            status: 'pending',
            attempts: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        }
      } else {
        // Створюємо новий job
        job = {
          id: jobId,
          ruleId: rule.id,
          visitId: visitId,
          companyId: companyId || 1169323,
          clientId: clientId || 0,
          instagram: instagram,
          datetime: datetime,
          dueAt: dueAt,
          payload: {
            clientName: clientName || 'Тестовий клієнт',
            phone: null,
            email: null,
            serviceTitle: null,
            staffName: null,
          },
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      await kvWrite.setRaw(jobKey, JSON.stringify(job));
      newJobIds.push(jobId);

      // Додаємо в індекс
      const indexKey = 'altegio:reminder:index';
      const indexRaw = await kvRead.getRaw(indexKey);
      let index: string[] = [];

      if (indexRaw) {
        try {
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
            index = parsed;
          } else {
            console.warn('[check-webhook] Index is not an array, resetting:', typeof parsed);
            index = [];
            await kvWrite.setRaw(indexKey, JSON.stringify(index));
          }
        } catch (err) {
          console.warn('[check-webhook] Failed to parse index:', err);
          index = [];
          await kvWrite.setRaw(indexKey, JSON.stringify(index));
        }
      }

      if (!index.includes(jobId)) {
        index.push(jobId);
        await kvWrite.setRaw(indexKey, JSON.stringify(index));
        console.log(`[check-webhook] Added job ${jobId} to index, total: ${index.length}`);
      } else {
        console.log(`[check-webhook] Job ${jobId} already in index`);
      }
    }

    // Оновлюємо індекс по visitId
    await kvWrite.setRaw(visitJobsKey, JSON.stringify(newJobIds));

    return NextResponse.json({
      ok: true,
      message: `Created/updated ${newJobIds.length} reminder jobs`,
      visitId,
      jobsCreated: newJobIds,
    });
  } catch (error) {
    console.error('[check-webhook] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

