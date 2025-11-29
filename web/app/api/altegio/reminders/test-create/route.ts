// web/app/api/altegio/reminders/test-create/route.ts
// Тестовий endpoint для ручного створення job'ів нагадувань

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { visitId, datetime, instagram, clientName } = body;

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

    console.log(`[test-create] Processing ${rules.length} rules for visit ${visitId}`, {
      datetime,
      visitAt: new Date(visitAt).toISOString(),
      now: new Date(now).toISOString(),
      daysUntilVisit: Math.round((visitAt - now) / (24 * 3600_000)),
    });

    for (const rule of rules) {
      const dueAt = calculateDueAt(datetime, rule.daysBefore);

      console.log(`[test-create] Rule ${rule.id} (${rule.daysBefore} days before):`, {
        dueAt: new Date(dueAt).toISOString(),
        now: new Date(now).toISOString(),
        visitAt: new Date(visitAt).toISOString(),
        isPast: dueAt <= now,
        diffMs: dueAt - now,
        diffHours: Math.round((dueAt - now) / (3600_000)),
      });

      if (dueAt <= now) {
        console.log(`[test-create] ⏭️ Skipping rule ${rule.id} - dueAt in past`);
        continue;
      }

      const jobId = generateReminderJobId(visitId, rule.id);
      const jobKey = `altegio:reminder:job:${jobId}`;

      const job: ReminderJob = {
        id: jobId,
        ruleId: rule.id,
        visitId: visitId,
        companyId: 1169323,
        clientId: 175956222,
        instagram: instagram,
        datetime: datetime,
        dueAt: dueAt,
        payload: {
          clientName: clientName || 'Тестовий клієнт',
          phone: null,
          email: null,
          serviceTitle: 'Тестова послуга',
          staffName: null,
        },
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await kvWrite.setRaw(jobKey, JSON.stringify(job));
      newJobIds.push(jobId);

      // Додаємо в індекс
      const indexKey = 'altegio:reminder:index';
      const indexRaw = await kvRead.getRaw(indexKey);
      let index: string[] = [];
      
      if (indexRaw) {
        try {
          const parsed = JSON.parse(indexRaw);
          if (Array.isArray(parsed)) {
            index = parsed;
          } else {
            console.warn('[test-create] Index is not an array, resetting:', typeof parsed, parsed);
            // Скидаємо до порожнього масиву, якщо не масив
            index = [];
            await kvWrite.setRaw(indexKey, JSON.stringify(index));
          }
        } catch (err) {
          console.warn('[test-create] Failed to parse index:', err);
          // Скидаємо до порожнього масиву при помилці парсингу
          index = [];
          await kvWrite.setRaw(indexKey, JSON.stringify(index));
        }
      }
      
      if (!index.includes(jobId)) {
        index.push(jobId);
        await kvWrite.setRaw(indexKey, JSON.stringify(index));
        console.log(`[test-create] Added job ${jobId} to index, total: ${index.length}`);
      } else {
        console.log(`[test-create] Job ${jobId} already in index`);
      }
    }

    // Оновлюємо індекс по visitId
    await kvWrite.setRaw(visitJobsKey, JSON.stringify(newJobIds));

    return NextResponse.json({
      ok: true,
      message: `Created ${newJobIds.length} reminder jobs`,
      visitId,
      jobsCreated: newJobIds,
    });
  } catch (error) {
    console.error('[test-create] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

