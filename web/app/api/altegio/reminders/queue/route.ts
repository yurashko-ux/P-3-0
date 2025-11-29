// web/app/api/altegio/reminders/queue/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import type { ReminderJob } from '@/lib/altegio/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const statusParam = req.nextUrl.searchParams.get('status') || 'pending';
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200)
      : 50;

    // Отримуємо всі job'и з індексу
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
            // Якщо не JSON, спробуємо як рядок
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
        
        // Перевіряємо, чи це масив
        if (Array.isArray(parsed)) {
          jobIds = parsed;
        } else {
          console.warn('[altegio/reminders/queue] Index is not an array, resetting:', typeof parsed, parsed);
          // Скидаємо до порожнього масиву, якщо не масив
          jobIds = [];
        }
      } catch (err) {
        console.warn('[altegio/reminders/queue] Failed to parse index:', err);
        jobIds = [];
      }
    }

    const jobs: ReminderJob[] = [];
    const now = Date.now();

    for (const jobId of jobIds) {
      const jobKey = `altegio:reminder:job:${jobId}`;
      const jobRaw = await kvRead.getRaw(jobKey);

      if (!jobRaw) {
        console.warn(`[queue] Job ${jobId} not found in KV`);
        continue;
      }

      try {
        // kvGetRaw може повернути об'єкт { value: '...' } або рядок
        let jobData: any;
        if (typeof jobRaw === 'string') {
          try {
            jobData = JSON.parse(jobRaw);
          } catch {
            jobData = jobRaw;
          }
        } else {
          jobData = jobRaw;
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
            console.warn(`[queue] Failed to parse job ${jobId} as JSON:`, err);
            continue;
          }
        }

        const job: ReminderJob = jobData;

        // Фільтруємо по статусу
        if (statusParam === 'all' || job.status === statusParam) {
          jobs.push(job);
        }
      } catch (err) {
        console.warn(
          `[altegio/reminders/queue] Failed to parse job ${jobId}:`,
          err,
        );
      }
    }

    // Сортуємо по dueAt (найближчі перші)
    jobs.sort((a, b) => a.dueAt - b.dueAt);

    // Фільтруємо тільки pending для "черги"
    const queue =
      statusParam === 'pending'
        ? jobs.filter((j) => {
            const isPending = j.status === 'pending';
            const isFuture = j.dueAt > now;
            const shouldInclude = isPending && isFuture;
            
            if (!shouldInclude) {
              console.log(`[queue] Filtering out job ${j.id}:`, {
                status: j.status,
                isPending,
                dueAt: new Date(j.dueAt).toISOString(),
                now: new Date(now).toISOString(),
                isFuture,
                diffMs: j.dueAt - now,
                diffHours: Math.round((j.dueAt - now) / (3600_000)),
              });
            }
            
            return shouldInclude;
          })
        : jobs.slice(0, limit);
    
    console.log(`[queue] Filter results:`, {
      totalJobs: jobs.length,
      filteredQueue: queue.length,
      statusParam,
      now: new Date(now).toISOString(),
    });

    // Форматуємо для UI
    const formatted = queue.map((job) => ({
      id: job.id,
      ruleId: job.ruleId,
      visitId: job.visitId,
      clientName: job.payload?.clientName || 'Невідомий клієнт',
      instagram: job.instagram,
      phone: job.payload?.phone || null,
      email: job.payload?.email || null,
      serviceTitle: job.payload?.serviceTitle || null,
      staffName: job.payload?.staffName || null,
      visitDateTime: job.datetime,
      dueAt: job.dueAt,
      dueAtFormatted: new Date(job.dueAt).toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      daysUntilVisit: Math.round(
        (new Date(job.datetime).getTime() - now) / (24 * 3600_000),
      ),
      status: job.status,
      attempts: job.attempts,
    }));

    return NextResponse.json({
      ok: true,
      count: formatted.length,
      jobs: formatted,
      debug: {
        indexTotal: jobIds.length,
        jobsBeforeFilter: jobs.length,
        jobsAfterFilter: queue.length,
        now: new Date(now).toISOString(),
      },
    });
  } catch (error) {
    console.error('[altegio/reminders/queue] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

