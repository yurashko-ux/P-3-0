// web/app/api/altegio/reminders/test-send/route.ts
// Endpoint для тестової відправки нагадування

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { getActiveReminderRules, formatReminderMessage, type ReminderJob } from '@/lib/altegio/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Симулює відправку Instagram DM
 */
async function sendInstagramDM(
  instagram: string,
  message: string,
  job: ReminderJob,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  // ⚠️ ТЕСТОВИЙ РЕЖИМ: відправляємо тільки на тестовий акаунт
  const TEST_INSTAGRAM = 'mykolayyurashko';
  if (instagram !== TEST_INSTAGRAM) {
    console.log(`[test-send] ⏭️ Skipping @${instagram} - not test account (only ${TEST_INSTAGRAM} allowed)`);
    return {
      success: false,
      error: `Test mode: only @${TEST_INSTAGRAM} allowed`,
    };
  }

  console.log(`[test-send] 📤 Sending Instagram DM to @${instagram}:`, {
    message,
    jobId: job.id,
    visitId: job.visitId,
    visitDate: job.datetime,
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
      console.log(`[test-send] Attempting to send via ManyChat API`);
      const manychatResult = await sendViaManyChat(instagram, message, manychatApiKey);
      if (manychatResult.success) {
        return manychatResult;
      }
      console.warn(`[test-send] ManyChat API failed, trying Instagram Graph API:`, manychatResult.error);
    } catch (err) {
      console.warn(`[test-send] ManyChat API error:`, err);
    }
  }

  // Спробуємо Instagram Graph API (якщо налаштовано)
  const instagramToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (instagramToken) {
    try {
      console.log(`[test-send] Attempting to send via Instagram Graph API`);
      const instagramResult = await sendViaInstagramGraph(instagram, message, instagramToken);
      if (instagramResult.success) {
        return instagramResult;
      }
      console.warn(`[test-send] Instagram Graph API failed:`, instagramResult.error);
    } catch (err) {
      console.warn(`[test-send] Instagram Graph API error:`, err);
    }
  }

  // Якщо нічого не налаштовано - симуляція (для тестування)
  console.log(`[test-send] ⚠️ No API configured, simulating send (mock mode)`);
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
  clientName?: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    // ManyChat API: спочатку пробуємо findByName (найпростіший спосіб)
    let subscriberId: string | null = null;
    let searchData: any = null;

    console.log(`[test-send] Searching ManyChat subscriber for @${instagram}${clientName ? ` (client: ${clientName})` : ''}`);
    
    // Метод 1: findByName - спочатку за Instagram username
    const nameSearchUrl = `https://api.manychat.com/fb/subscriber/findByName`;
    const nameSearchResponse = await fetch(nameSearchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: instagram,
      }),
    });

    if (nameSearchResponse.ok) {
      searchData = await nameSearchResponse.json();
      subscriberId = searchData?.data?.subscriber_id || searchData?.subscriber_id || searchData?.subscriber?.id;
      console.log(`[test-send] findByName (by Instagram) result:`, searchData);
    } else {
      const errorText = await nameSearchResponse.text();
      console.warn(`[test-send] ManyChat findByName (by Instagram) failed: ${nameSearchResponse.status} ${errorText}`);
    }

    // Метод 1.5: Якщо не знайшли за Instagram, пробуємо за ім'ям клієнта
    if (!subscriberId && clientName) {
      console.log(`[test-send] Trying findByName by client name: ${clientName}`);
      const nameSearchByClientResponse = await fetch(nameSearchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: clientName,
        }),
      });

      if (nameSearchByClientResponse.ok) {
        searchData = await nameSearchByClientResponse.json();
        subscriberId = searchData?.data?.subscriber_id || searchData?.subscriber_id || searchData?.subscriber?.id;
        if (subscriberId) {
          console.log(`[test-send] ✅ Found subscriber by client name: ${clientName}`);
        }
      } else {
        const errorText = await nameSearchByClientResponse.text();
        console.warn(`[test-send] ManyChat findByName (by client name) failed: ${nameSearchByClientResponse.status} ${errorText}`);
      }
    }

    // Метод 2: Якщо не знайшли, пробуємо findByCustomField (якщо є custom field для Instagram)
    if (!subscriberId) {
      console.log(`[test-send] Trying findByCustomField for @${instagram}`);
      // ManyChat може мати custom field для Instagram username
      // Спробуємо різні варіанти field_id
      const customFieldIds = ['instagram_username', 'instagram', 'username', 'ig_username'];
      
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
            field_value: instagram,
          }),
        });

        if (customSearchResponse.ok) {
          searchData = await customSearchResponse.json();
          subscriberId = searchData?.data?.subscriber_id || searchData?.subscriber_id || searchData?.subscriber?.id;
          if (subscriberId) {
            console.log(`[test-send] Found via findByCustomField with field_id: ${fieldId}`);
            break;
          }
        }
      }
    }

    if (!subscriberId) {
      return {
        success: false,
        error: `Subscriber not found in ManyChat for @${instagram}. Make sure the user has interacted with your ManyChat bot.`,
      };
    }

    console.log(`[test-send] Found subscriber_id: ${subscriberId} for @${instagram}`);

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
    const pageId = process.env.INSTAGRAM_PAGE_ID;
    if (!pageId) {
      return {
        success: false,
        error: 'INSTAGRAM_PAGE_ID not configured',
      };
    }

    // Отримуємо Instagram Business Account ID
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
    const igAccountId = pageData?.instagram_business_account?.id;

    if (!igAccountId) {
      return {
        success: false,
        error: 'Instagram Business Account not found',
      };
    }

    // TODO: Instagram Graph API вимагає отримати user_id за username
    // Це складніше, потрібен додатковий крок для пошуку користувача
    return {
      success: false,
      error: 'Instagram Graph API requires additional user lookup (not implemented yet)',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, instagram, message } = body;

    if (!jobId && !instagram) {
      return NextResponse.json(
        {
          ok: false,
          error: 'jobId or instagram required',
        },
        { status: 400 },
      );
    }

    let job: ReminderJob | null = null;

    // Якщо передано jobId, завантажуємо job з KV
    if (jobId) {
      const jobKey = `altegio:reminder:job:${jobId}`;
      const jobRaw = await kvRead.getRaw(jobKey);

      if (jobRaw) {
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
            return NextResponse.json(
              {
                ok: false,
                error: `Failed to parse job: ${err instanceof Error ? err.message : String(err)}`,
              },
              { status: 400 },
            );
          }
        }

        job = jobData as ReminderJob;
      }
    }

    // Якщо job не знайдено, створюємо тестовий
    if (!job) {
      const rules = await getActiveReminderRules();
      const rule = rules[0] || {
        id: 'test',
        daysBefore: 1,
        active: true,
        channel: 'instagram_dm',
        template: message || 'Тестове повідомлення: {date} о {time}',
      };

      const testDatetime = new Date();
      testDatetime.setDate(testDatetime.getDate() + 1);
      testDatetime.setHours(15, 0, 0, 0);

      job = {
        id: 'test_send',
        ruleId: rule.id,
        visitId: 999999,
        companyId: 1169323,
        clientId: 0,
        instagram: instagram || 'mykolayyurashko',
        datetime: testDatetime.toISOString(),
        dueAt: Date.now(),
        payload: {
          clientName: 'Тестовий клієнт',
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

    // Форматуємо повідомлення
    const rules = await getActiveReminderRules();
    const rule = rules.find((r) => r.id === job.ruleId) || rules[0];
    
    if (!rule) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Rule not found',
        },
        { status: 400 },
      );
    }

    const formattedMessage = message || formatReminderMessage(job, rule);

    // Відправляємо
    const result = await sendInstagramDM(job.instagram || instagram || '', formattedMessage, job);

    const method = result.messageId?.startsWith('manychat_') 
      ? 'ManyChat API' 
      : result.messageId?.startsWith('mock_') 
        ? 'Mock (симуляція - ManyChat API не налаштовано або subscriber не знайдено)' 
        : 'Instagram Graph API';

    return NextResponse.json({
      ok: result.success,
      message: result.success 
        ? `Повідомлення відправлено через ${method}!` 
        : 'Помилка відправки',
      result,
      job: {
        id: job.id,
        instagram: job.instagram,
        message: formattedMessage,
      },
      method,
      diagnostics: {
        manychatApiKeyConfigured: !!(
          process.env.MANYCHAT_API_KEY || 
          process.env.ManyChat_API_Key ||
          process.env.MANYCHAT_API_TOKEN || 
          process.env.MC_API_KEY ||
          process.env.MANYCHAT_APIKEY
        ),
        instagramTokenConfigured: !!process.env.INSTAGRAM_ACCESS_TOKEN,
        manychatApiKeyName: process.env.MANYCHAT_API_KEY ? 'MANYCHAT_API_KEY' :
                            process.env.ManyChat_API_Key ? 'ManyChat_API_Key' :
                            process.env.MANYCHAT_API_TOKEN ? 'MANYCHAT_API_TOKEN' :
                            process.env.MC_API_KEY ? 'MC_API_KEY' :
                            process.env.MANYCHAT_APIKEY ? 'MANYCHAT_APIKEY' : 'not found',
      },
    });
  } catch (error) {
    console.error('[test-send] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
