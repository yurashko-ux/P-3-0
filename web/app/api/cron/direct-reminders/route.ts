// web/app/api/cron/direct-reminders/route.ts
// Cron job для надсилання нагадувань про Direct клієнтів

import { NextRequest, NextResponse } from 'next/server';
import { getPendingDirectReminders, getRepeatReminders, saveDirectReminder } from '@/lib/direct-reminders/store';
import { sendDirectReminderToAdmins, sendRepeatReminderToAdmins } from '@/lib/direct-reminders/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Перевіряє, чи запит дозволений (тільки Vercel Cron або з секретом)
 */
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

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  console.log('[cron/direct-reminders] POST request received');

  if (!okCron(req)) {
    console.log('[cron/direct-reminders] Request forbidden - not a valid cron request');
    return NextResponse.json(
      { ok: false, error: 'forbidden' },
      { status: 403 }
    );
  }

  try {
    const now = new Date();
    const results = {
      pendingSent: 0,
      repeatSent: 0,
      errors: [] as string[],
    };

    // 1. Надсилаємо нагадування, які очікують надсилання
    try {
      const pendingReminders = await getPendingDirectReminders(now);
      console.log(`[cron/direct-reminders] Found ${pendingReminders.length} pending reminders`);

      for (const reminder of pendingReminders) {
        try {
          await sendDirectReminderToAdmins(reminder, true); // isTestMode = true
          
          // Оновлюємо статус нагадування
          reminder.status = 'sent';
          reminder.sentAt = now.toISOString();
          reminder.reminderCount = 1;
          reminder.updatedAt = now.toISOString();
          await saveDirectReminder(reminder);
          
          results.pendingSent++;
          console.log(`[cron/direct-reminders] ✅ Sent pending reminder ${reminder.id}`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.errors.push(`Failed to send reminder ${reminder.id}: ${errorMsg}`);
          console.error(`[cron/direct-reminders] ❌ Failed to send reminder ${reminder.id}:`, err);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Failed to get pending reminders: ${errorMsg}`);
      console.error('[cron/direct-reminders] ❌ Failed to get pending reminders:', err);
    }

    // 2. Надсилаємо повторні нагадування (для "Недодзвон")
    try {
      const repeatReminders = await getRepeatReminders(now);
      console.log(`[cron/direct-reminders] Found ${repeatReminders.length} repeat reminders`);

      for (const reminder of repeatReminders) {
        try {
          await sendRepeatReminderToAdmins(reminder, true); // isTestMode = true
          
          // Оновлюємо статус нагадування
          reminder.lastReminderAt = now.toISOString();
          reminder.reminderCount = reminder.reminderCount + 1;
          reminder.updatedAt = now.toISOString();
          await saveDirectReminder(reminder);
          
          results.repeatSent++;
          console.log(`[cron/direct-reminders] ✅ Sent repeat reminder ${reminder.id} (count: ${reminder.reminderCount})`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.errors.push(`Failed to send repeat reminder ${reminder.id}: ${errorMsg}`);
          console.error(`[cron/direct-reminders] ❌ Failed to send repeat reminder ${reminder.id}:`, err);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Failed to get repeat reminders: ${errorMsg}`);
      console.error('[cron/direct-reminders] ❌ Failed to get repeat reminders:', err);
    }

    return NextResponse.json({
      ok: true,
      timestamp: now.toISOString(),
      results,
    });
  } catch (err) {
    console.error('[cron/direct-reminders] ❌ Fatal error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

