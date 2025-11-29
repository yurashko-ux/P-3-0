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
        const parsed = JSON.parse(indexRaw);
        // Перевіряємо, чи це масив
        if (Array.isArray(parsed)) {
          jobIds = parsed;
        } else {
          console.warn('[altegio/reminders/queue] Index is not an array:', typeof parsed);
        }
      } catch (err) {
        console.warn('[altegio/reminders/queue] Failed to parse index:', err);
      }
    }

    const jobs: ReminderJob[] = [];
    const now = Date.now();

    for (const jobId of jobIds) {
      const jobKey = `altegio:reminder:job:${jobId}`;
      const jobRaw = await kvRead.getRaw(jobKey);

      if (!jobRaw) continue;

      try {
        const job: ReminderJob = JSON.parse(jobRaw);

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
            if (!isPending || !isFuture) {
              console.log(`[queue] Filtering out job ${j.id}:`, {
                status: j.status,
                isPending,
                dueAt: new Date(j.dueAt).toISOString(),
                now: new Date(now).toISOString(),
                isFuture,
                diffMs: j.dueAt - now,
              });
            }
            return isPending && isFuture;
          })
        : jobs.slice(0, limit);

    // Форматуємо для UI
    const formatted = queue.map((job) => ({
      id: job.id,
      ruleId: job.ruleId,
      visitId: job.visitId,
      clientName: job.payload.clientName,
      instagram: job.instagram,
      phone: job.payload.phone,
      email: job.payload.email,
      serviceTitle: job.payload.serviceTitle,
      staffName: job.payload.staffName,
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

