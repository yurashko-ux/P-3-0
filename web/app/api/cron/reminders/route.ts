// web/app/api/cron/reminders/route.ts
// Cron job для обробки та відправки нагадувань про візити

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';
import {
  getActiveReminderRules,
  formatReminderMessage,
  type ReminderJob,
} from '@/lib/altegio/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function okCron(req: NextRequest) {
  // 1) Дозволяємо офіційний крон Vercel
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return true;

  // 2) Або запит з локальним секретом (на випадок ручного виклику)
  const urlSecret = req.nextUrl.searchParams.get('secret');
  const envSecret = process.env.CRON_SECRET || '';
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

/**
 * Симулює відправку Instagram DM
 * TODO: Замінити на реальну відправку через Instagram Graph API
 */
async function sendInstagramDM(
  instagram: string,
  message: string,
  job: ReminderJob,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  // Поки що це симуляція - просто логуємо
  console.log(`[reminders] 📤 Sending Instagram DM to @${instagram}:`, {
    message,
    jobId: job.id,
    visitId: job.visitId,
    visitDate: job.datetime,
  });

  // TODO: Реальна відправка через Instagram Graph API
  // const response = await fetch('https://graph.instagram.com/v18.0/me/messages', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     recipient: { username: instagram },
  //     message: { text: message },
  //   }),
  // });

  // Поки що завжди успішно
  return {
    success: true,
    messageId: `mock_${Date.now()}_${job.id}`,
  };
}

/**
 * Логує відправлене повідомлення в KV
 */
async function logSentMessage(
  job: ReminderJob,
  message: string,
  result: { success: boolean; error?: string; messageId?: string },
): Promise<void> {
  const logKey = 'altegio:reminder:sent:log';
  const logEntry = {
    timestamp: Date.now(),
    jobId: job.id,
    visitId: job.visitId,
    instagram: job.instagram,
    clientName: job.payload.clientName,
    message,
    result,
    visitDateTime: job.datetime,
    ruleId: job.ruleId,
  };

  // Отримуємо поточний лог
  const logRaw = await kvRead.getRaw(logKey);
  let logs: any[] = [];

  if (logRaw) {
    try {
      let parsed: any;
      if (typeof logRaw === 'string') {
        try {
          parsed = JSON.parse(logRaw);
        } catch {
          parsed = logRaw;
        }
      } else {
        parsed = logRaw;
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
        logs = parsed;
      }
    } catch (err) {
      console.warn('[reminders] Failed to parse sent log:', err);
      logs = [];
    }
  }

  // Додаємо новий запис на початок
  logs.unshift(logEntry);

  // Зберігаємо тільки останні 1000 записів
  if (logs.length > 1000) {
    logs = logs.slice(0, 1000);
  }

  await kvWrite.setRaw(logKey, JSON.stringify(logs));
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  console.log('[reminders] POST request received');

  if (!okCron(req)) {
    console.log('[reminders] Request forbidden - not a valid cron request');
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  console.log('[reminders] Request authorized, starting reminder processing');

  try {
    const now = Date.now();
    const rules = getActiveReminderRules();
    const rulesMap = new Map(rules.map((r) => [r.id, r]));

    // Отримуємо всі job'и з індексу
    const indexKey = 'altegio:reminder:index';
    const indexRaw = await kvRead.getRaw(indexKey);
    let jobIds: string[] = [];

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
          jobIds = parsed;
        }
      } catch (err) {
        console.warn('[reminders] Failed to parse index:', err);
        jobIds = [];
      }
    }

    console.log(`[reminders] Found ${jobIds.length} jobs in index`);

    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Обробляємо кожен job
    for (const jobId of jobIds) {
      try {
        const jobKey = `altegio:reminder:job:${jobId}`;
        const jobRaw = await kvRead.getRaw(jobKey);

        if (!jobRaw) {
          console.warn(`[reminders] Job ${jobId} not found in KV`);
          continue;
        }

        // Парсимо job
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

        if (typeof jobData === 'string') {
          try {
            jobData = JSON.parse(jobData);
          } catch (err) {
            console.warn(`[reminders] Failed to parse job ${jobId}:`, err);
            continue;
          }
        }

        const job: ReminderJob = jobData;
        results.processed++;

        // Перевіряємо, чи job готовий до відправки
        if (job.status !== 'pending') {
          console.log(`[reminders] ⏭️ Skipping job ${jobId}: status=${job.status}`);
          results.skipped++;
          continue;
        }

        if (job.dueAt > now) {
          console.log(`[reminders] ⏭️ Skipping job ${jobId}: dueAt in future (${new Date(job.dueAt).toISOString()})`);
          results.skipped++;
          continue;
        }

        if (!job.instagram) {
          console.log(`[reminders] ⏭️ Skipping job ${jobId}: no Instagram username`);
          results.skipped++;
          continue;
        }

        // Отримуємо правило
        const rule = rulesMap.get(job.ruleId);
        if (!rule) {
          console.warn(`[reminders] ⚠️ Rule ${job.ruleId} not found for job ${jobId}`);
          job.status = 'failed';
          job.lastError = `Rule ${job.ruleId} not found`;
          job.updatedAt = now;
          await kvWrite.setRaw(jobKey, JSON.stringify(job));
          results.failed++;
          continue;
        }

        // Форматуємо повідомлення
        const message = formatReminderMessage(job, rule);

        // Відправляємо повідомлення
        console.log(`[reminders] 📤 Sending reminder for job ${jobId} to @${job.instagram}`);
        const sendResult = await sendInstagramDM(job.instagram, message, job);

        if (sendResult.success) {
          // Оновлюємо статус job'а
          job.status = 'sent';
          job.updatedAt = now;
          job.attempts++;
          delete job.lastError;

          await kvWrite.setRaw(jobKey, JSON.stringify(job));

          // Логуємо відправлене повідомлення
          await logSentMessage(job, message, sendResult);

          results.sent++;
          console.log(`[reminders] ✅ Successfully sent reminder for job ${jobId}`);
        } else {
          // Оновлюємо статус job'а як failed
          job.status = 'failed';
          job.lastError = sendResult.error || 'Unknown error';
          job.attempts++;
          job.updatedAt = now;

          await kvWrite.setRaw(jobKey, JSON.stringify(job));

          results.failed++;
          results.errors.push(`Job ${jobId}: ${sendResult.error || 'Unknown error'}`);
          console.error(`[reminders] ❌ Failed to send reminder for job ${jobId}:`, sendResult.error);
        }
      } catch (err) {
        console.error(`[reminders] Error processing job ${jobId}:`, err);
        results.errors.push(`Job ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
        results.failed++;
      }
    }

    const response = {
      ok: true,
      timestamp: new Date().toISOString(),
      summary: results,
    };

    console.log('[reminders] Reminder processing completed:', results);

    return NextResponse.json(response);
  } catch (e: any) {
    console.error('[reminders] Fatal error:', e);
    return NextResponse.json(
      {
        ok: false,
        error: String(e),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

