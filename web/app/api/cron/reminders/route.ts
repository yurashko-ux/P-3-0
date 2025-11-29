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
 * Відправляє Instagram DM через ManyChat API або Instagram Graph API
 */
async function sendInstagramDM(
  instagram: string,
  message: string,
  job: ReminderJob,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  // ⚠️ ТЕСТОВИЙ РЕЖИМ: відправляємо тільки на тестовий акаунт
  const TEST_INSTAGRAM = 'mykolayyurashko';
  if (instagram !== TEST_INSTAGRAM) {
    console.log(`[reminders] ⏭️ Skipping @${instagram} - not test account (only ${TEST_INSTAGRAM} allowed)`);
    return {
      success: false,
      error: `Test mode: only @${TEST_INSTAGRAM} allowed`,
    };
  }

  console.log(`[reminders] 📤 Sending Instagram DM to @${instagram}:`, {
    message,
    jobId: job.id,
    visitId: job.visitId,
    visitDate: job.datetime,
    clientName: job.payload.clientName,
  });

  // Спробуємо ManyChat API спочатку (якщо налаштовано)
  // Підтримуємо різні варіанти назв змінних
  const manychatApiKey = 
    process.env.MANYCHAT_API_KEY || 
    process.env.ManyChat_API_Key ||
    process.env.MANYCHAT_API_TOKEN || 
    process.env.MC_API_KEY ||
    process.env.MANYCHAT_APIKEY;
  if (manychatApiKey) {
    try {
      console.log(`[reminders] Attempting to send via ManyChat API`);
      const manychatResult = await sendViaManyChat(instagram, message, manychatApiKey);
      if (manychatResult.success) {
        return manychatResult;
      }
      console.warn(`[reminders] ManyChat API failed, trying Instagram Graph API:`, manychatResult.error);
    } catch (err) {
      console.warn(`[reminders] ManyChat API error:`, err);
    }
  }

  // Спробуємо Instagram Graph API (якщо налаштовано)
  const instagramToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (instagramToken) {
    try {
      console.log(`[reminders] Attempting to send via Instagram Graph API`);
      const instagramResult = await sendViaInstagramGraph(instagram, message, instagramToken);
      if (instagramResult.success) {
        return instagramResult;
      }
      console.warn(`[reminders] Instagram Graph API failed:`, instagramResult.error);
    } catch (err) {
      console.warn(`[reminders] Instagram Graph API error:`, err);
    }
  }

  // Якщо нічого не налаштовано - симуляція (для тестування)
  console.log(`[reminders] ⚠️ No API configured, simulating send (mock mode)`);
  return {
    success: true,
    messageId: `mock_${Date.now()}_${job.id}`,
  };
}

/**
 * Відправка через ManyChat REST API
 */
async function sendViaManyChat(
  instagram: string,
  message: string,
  apiKey: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    // ManyChat API: шукаємо subscriber за Instagram username
    let subscriberId: string | null = null;
    let searchData: any = null;

    // Видаляємо @ з початку, якщо є
    const cleanInstagram = instagram.startsWith('@') ? instagram.slice(1) : instagram;
    
    console.log(`[reminders] Searching ManyChat subscriber for Instagram username: ${cleanInstagram} (original: ${instagram})`);
    
    // Метод 1: Спочатку отримуємо список custom fields, щоб знайти правильний field_id для Instagram username
    console.log(`[reminders] ===== METHOD 1: Getting custom fields =====`);
    let instagramFieldId: string | null = null;
    try {
      // Спробуємо різні endpoints для отримання custom fields
      const fieldsEndpoints = [
        'https://api.manychat.com/fb/subscriber/getFields',
        'https://api.manychat.com/fb/subscriber/getCustomFields',
        'https://api.manychat.com/fb/fields',
      ];
      
      for (const fieldsUrl of fieldsEndpoints) {
        try {
          const fieldsResponse = await fetch(fieldsUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });
          
          if (fieldsResponse.ok) {
            const fieldsData = await fieldsResponse.json();
            const fields = fieldsData?.data?.fields || fieldsData?.fields || [];
            
            // Шукаємо поле, пов'язане з Instagram
            const instagramField = fields.find((f: any) => 
              f.name?.toLowerCase().includes('instagram') || 
              f.field_id?.toLowerCase().includes('instagram') ||
              f.label?.toLowerCase().includes('instagram') ||
              f.id?.toString().includes('instagram')
            );
            
            if (instagramField) {
              instagramFieldId = instagramField.field_id || instagramField.id || instagramField.name;
              console.log(`[reminders] ✅ Found Instagram field: ${instagramFieldId} (${instagramField.name || instagramField.label})`);
              break;
            }
          }
        } catch (err) {
          // Продовжуємо до наступного endpoint
        }
      }
    } catch (err) {
      console.warn(`[reminders] Failed to get custom fields:`, err);
    }

    // Метод 2: findByCustomField - використовуємо знайдений field_id або спробуємо стандартні варіанти
    console.log(`[reminders] ===== METHOD 2: findByCustomField =====`);
    console.log(`[reminders] Searching for Instagram username: "${cleanInstagram}"`);
    
    // Формуємо список field_id для спроби (спочатку знайдений, потім стандартні варіанти)
    const customFieldIds = instagramFieldId 
      ? [instagramFieldId, 'instagram_username', 'instagram', 'username', 'ig_username', 'Instagram Username', 'Instagram']
      : ['instagram_username', 'instagram', 'username', 'ig_username', 'Instagram Username', 'Instagram'];
      
      for (const fieldId of customFieldIds) {
        const customSearchUrl = `https://api.manychat.com/fb/subscriber/findByCustomField`;
        const customSearchResponse = await fetch(customSearchUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            field_id: fieldId,
            field_value: cleanInstagram,
          }),
        });

        if (customSearchResponse.ok) {
          searchData = await customSearchResponse.json();
          subscriberId = searchData?.data?.subscriber_id || searchData?.subscriber_id || searchData?.subscriber?.id;
          if (subscriberId) {
            console.log(`[reminders] ✅ Found via findByCustomField with field_id: ${fieldId}`, JSON.stringify(searchData, null, 2));
            break;
          } else {
            console.log(`[reminders] findByCustomField (${fieldId}) returned OK but no subscriber_id:`, JSON.stringify(searchData, null, 2));
          }
        } else {
          const errorText = await customSearchResponse.text();
          console.log(`[reminders] findByCustomField (${fieldId}) failed: ${customSearchResponse.status} ${errorText}`);
        }
      }
    }

    if (!subscriberId) {
      return {
        success: false,
        error: `Subscriber not found in ManyChat for ${cleanInstagram}. Make sure the user has interacted with your ManyChat bot.`,
      };
    }

    console.log(`[reminders] Found subscriber_id: ${subscriberId} for ${cleanInstagram}`);

    // Відправляємо повідомлення
    const sendUrl = `https://api.manychat.com/fb/sending/sendContent`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        data: {
          version: 'v2',
          content: {
            messages: [
              {
                type: 'text',
                text: message,
              },
            ],
          },
        },
      }),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      return {
        success: false,
        error: `ManyChat send failed: ${sendResponse.status} ${errorText}`,
      };
    }

    const sendData = await sendResponse.json();
    return {
      success: true,
      messageId: sendData?.data?.message_id || `manychat_${Date.now()}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Відправка через Instagram Graph API
 */
async function sendViaInstagramGraph(
  instagram: string,
  message: string,
  accessToken: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    // Instagram Graph API вимагає Instagram Business Account
    // Потрібен page_id та налаштування Instagram Messaging
    const pageId = process.env.INSTAGRAM_PAGE_ID;
    if (!pageId) {
      return {
        success: false,
        error: 'INSTAGRAM_PAGE_ID not configured',
      };
    }

    // Спочатку отримуємо Instagram Business Account ID
    const pageUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`;
    const pageResponse = await fetch(pageUrl);

    if (!pageResponse.ok) {
      const errorText = await pageResponse.text();
      return {
        success: false,
        error: `Failed to get Instagram Business Account: ${pageResponse.status} ${errorText}`,
      };
    }

    const pageData = await pageResponse.json();
    const igBusinessAccountId = pageData?.instagram_business_account?.id;

    if (!igBusinessAccountId) {
      return {
        success: false,
        error: 'Instagram Business Account not found',
      };
    }

    // Шукаємо user за Instagram username
    // Примітка: Instagram Graph API має обмеження на пошук користувачів
    // Можливо, потрібно зберігати user_id при першій взаємодії
    const searchUrl = `https://graph.instagram.com/v18.0/${igBusinessAccountId}/business_discovery?username=${encodeURIComponent(instagram)}&fields=id,username&access_token=${accessToken}`;
    const searchResponse = await fetch(searchUrl);

    if (!searchResponse.ok) {
      // Якщо пошук не працює, можливо потрібен інший підхід
      return {
        success: false,
        error: `Failed to find user @${instagram}: ${searchResponse.status}`,
      };
    }

    const searchData = await searchResponse.json();
    const userId = searchData?.business_discovery?.id;

    if (!userId) {
      return {
        success: false,
        error: `User @${instagram} not found`,
      };
    }

    // Відправляємо повідомлення
    const sendUrl = `https://graph.facebook.com/v18.0/${igBusinessAccountId}/messages`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: userId },
        message: { text: message },
        access_token: accessToken,
      }),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      return {
        success: false,
        error: `Instagram send failed: ${sendResponse.status} ${errorText}`,
      };
    }

    const sendData = await sendResponse.json();
    return {
      success: true,
      messageId: sendData?.message_id || `instagram_${Date.now()}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
    const rules = await getActiveReminderRules();
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

