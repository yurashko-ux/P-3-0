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
    const webhookLogRaw = await kvRead.lrange('altegio:webhook:log', 0, 9);
    const webhookEvents = webhookLogRaw
      .map((raw) => {
        try {
          return JSON.parse(raw);
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
        const parsed = JSON.parse(indexRaw);
        if (Array.isArray(parsed)) {
          jobIds = parsed;
        }
      } catch (err) {
        console.warn('[altegio/reminders/debug] Failed to parse index:', err);
      }
    }

    // 3. Завантажуємо всі job'и
    const jobs: ReminderJob[] = [];
    for (const jobId of jobIds) {
      const jobKey = `altegio:reminder:job:${jobId}`;
      const jobRaw = await kvRead.getRaw(jobKey);
      if (jobRaw) {
        try {
          jobs.push(JSON.parse(jobRaw));
        } catch (err) {
          console.warn(`[altegio/reminders/debug] Failed to parse job ${jobId}:`, err);
        }
      }
    }

    // 4. Шукаємо останні події по record
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

    // 5. Перевіряємо job'и по visitId
    const jobsByVisit = new Map<number, ReminderJob[]>();
    for (const job of jobs) {
      if (!jobsByVisit.has(job.visitId)) {
        jobsByVisit.set(job.visitId, []);
      }
      jobsByVisit.get(job.visitId)!.push(job);
    }

    return NextResponse.json({
      ok: true,
      diagnostics: {
        webhookEvents: {
          total: webhookEvents.length,
          recordEvents: recordEvents.length,
          lastRecordEvents: recordEvents.slice(0, 5),
        },
        jobs: {
          total: jobs.length,
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

