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
  manualSubscriberId?: string,
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
      const manychatResult = await sendViaManyChat(instagram, message, manychatApiKey, manualSubscriberId);
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
  manualSubscriberId?: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    // ManyChat API: шукаємо subscriber за Instagram username
    let subscriberId: string | null = null;
    let searchData: any = null;

    // Видаляємо @ з початку, якщо є
    const cleanInstagram = instagram.startsWith('@') ? instagram.slice(1) : instagram;
    
    console.log(`[test-send] Searching ManyChat subscriber for Instagram username: ${cleanInstagram} (original: ${instagram})`);
    
    // Метод 1: getSubscribers з фільтрацією за ig_username (системне поле ManyChat)
    console.log(`[test-send] ===== METHOD 1: getSubscribers with ig_username filter =====`);
    try {
      // ManyChat API: отримуємо subscribers з пагінацією та фільтруємо за ig_username
      const maxPages = 10; // Збільшуємо кількість сторінок
      const pageSize = 100;
      
      for (let page = 1; page <= maxPages; page++) {
        const subscribersUrl = `https://api.manychat.com/fb/subscriber/getSubscribers?page=${page}&limit=${pageSize}`;
        console.log(`[test-send] Fetching page ${page} from getSubscribers...`);
        
        const subscribersResponse = await fetch(subscribersUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        
        if (subscribersResponse.ok) {
          const subscribersData = await subscribersResponse.json();
          const subscribers = subscribersData?.data || [];
          
          console.log(`[test-send] Page ${page}: received ${subscribers.length} subscribers`);
          
          // Логуємо перші кілька subscribers для діагностики
          if (page === 1 && subscribers.length > 0) {
            const firstSub = subscribers[0];
            console.log(`[test-send] Sample subscriber structure:`, JSON.stringify({
              id: firstSub.id,
              name: firstSub.name,
              ig_username: firstSub.ig_username,
              has_ig_username: !!firstSub.ig_username,
              keys: Object.keys(firstSub).slice(0, 10),
            }, null, 2));
          }
          
          // Шукаємо subscriber з відповідним ig_username
          const foundSubscriber = subscribers.find((sub: any) => {
            const subIgUsername = sub.ig_username?.toLowerCase().trim();
            const searchIgUsername = cleanInstagram.toLowerCase().trim();
            const match = subIgUsername === searchIgUsername;
            
            if (subIgUsername) {
              console.log(`[test-send] Checking subscriber ${sub.id}: ig_username="${subIgUsername}" vs search="${searchIgUsername}" -> ${match ? 'MATCH!' : 'no match'}`);
            }
            
            return match;
          });
          
          if (foundSubscriber) {
            subscriberId = foundSubscriber.id || foundSubscriber.subscriber_id;
            searchData = foundSubscriber;
            console.log(`[test-send] ✅ Found subscriber via getSubscribers on page ${page}: ${subscriberId}`, JSON.stringify(foundSubscriber, null, 2));
            break;
          }
          
          // Якщо на цій сторінці менше ніж pageSize, це остання сторінка
          if (subscribers.length < pageSize) {
            console.log(`[test-send] Last page reached (${subscribers.length} < ${pageSize})`);
            break;
          }
        } else {
          const errorText = await subscribersResponse.text();
          console.warn(`[test-send] getSubscribers failed on page ${page}: ${subscribersResponse.status} ${errorText.substring(0, 200)}`);
          break;
        }
      }
      
      if (!subscriberId) {
        console.warn(`[test-send] ❌ Subscriber not found via getSubscribers after checking up to ${maxPages} pages`);
      }
    } catch (err) {
      console.error(`[test-send] getSubscribers error:`, err);
    }

    // Метод 2: findByCustomField - якщо getSubscribers не спрацював
    if (!subscriberId) {
      console.log(`[test-send] ===== METHOD 2: findByCustomField =====`);
      console.log(`[test-send] Trying findByCustomField for Instagram username: "${cleanInstagram}"`);
      
      // Спробуємо стандартні варіанти field_id
      const customFieldIds = ['ig_username', 'instagram_username', 'instagram', 'username', 'Instagram Username', 'Instagram'];
      
      for (const fieldId of customFieldIds) {
        if (subscriberId) break; // Якщо вже знайшли, зупиняємося
        
        console.log(`[test-send] Trying field_id: "${fieldId}"`);
        const customSearchUrl = `https://api.manychat.com/fb/subscriber/findByCustomField`;
        const customSearchRequest = {
          field_id: fieldId,
          field_value: cleanInstagram,
        };
        console.log(`[test-send] Request body:`, JSON.stringify(customSearchRequest, null, 2));
        
        const customSearchResponse = await fetch(customSearchUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(customSearchRequest),
        });

        const customResponseText = await customSearchResponse.text();
        console.log(`[test-send] Response status: ${customSearchResponse.status} ${customSearchResponse.statusText}`);
        console.log(`[test-send] Response text (first 500 chars):`, customResponseText.substring(0, 500));

        if (customSearchResponse.ok) {
          try {
            searchData = JSON.parse(customResponseText);
            console.log(`[test-send] Response JSON:`, JSON.stringify(searchData, null, 2));
            subscriberId = searchData?.data?.subscriber_id || searchData?.subscriber_id || searchData?.subscriber?.id;
            if (subscriberId) {
              console.log(`[test-send] ✅ Found via findByCustomField with field_id: ${fieldId}, subscriber_id: ${subscriberId}`);
              break;
            } else {
              console.log(`[test-send] ⚠️ findByCustomField (${fieldId}) returned OK but no subscriber_id`);
            }
          } catch (e) {
            console.error(`[test-send] Failed to parse findByCustomField response as JSON:`, e);
            console.log(`[test-send] Raw response:`, customResponseText);
          }
        } else {
          console.warn(`[test-send] ❌ findByCustomField (${fieldId}) failed: ${customSearchResponse.status} ${customResponseText}`);
          try {
            const errorData = JSON.parse(customResponseText);
            console.warn(`[test-send] Error details:`, JSON.stringify(errorData, null, 2));
          } catch {
            // Not JSON
          }
        }
      }
    }

    // Якщо не знайшли через API, але передано вручну - використовуємо вручну
    if (!subscriberId && !manualSubscriberId) {
      return {
        success: false,
        error: `Subscriber not found in ManyChat for ${cleanInstagram}. Make sure the user has interacted with your ManyChat bot. You can also provide subscriber_id manually for testing.`,
      };
    }

    if (subscriberId) {
      console.log(`[test-send] Found subscriber_id: ${subscriberId} for ${cleanInstagram}`);
    } else if (manualSubscriberId) {
      console.log(`[test-send] Using manual subscriber_id: ${manualSubscriberId} for ${cleanInstagram}`);
    }

    // Якщо передано subscriber_id вручну, використовуємо його
    const finalSubscriberId = manualSubscriberId || subscriberId;
    
    if (!finalSubscriberId) {
      return {
        success: false,
        error: `Subscriber not found in ManyChat for ${cleanInstagram}. Make sure the user has interacted with your ManyChat bot. You can also provide subscriber_id manually for testing.`,
      };
    }

    console.log(`[test-send] Using subscriber_id: ${finalSubscriberId}${manualSubscriberId ? ' (manual)' : ' (found via API)'}`);

    // Відправляємо повідомлення
    const sendUrl = `https://api.manychat.com/fb/sending/sendContent`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: finalSubscriberId,
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
    const messageId = sendData?.data?.message_id || `manychat_${Date.now()}`;

    // Зберігаємо вихідне повідомлення в базу даних
    try {
      const { PrismaClient } = await import('@prisma/client');
      const { normalizeInstagram } = await import('@/lib/normalize');
      const prisma = new PrismaClient();
      
      const normalizedInstagram = normalizeInstagram(cleanInstagram);
      if (!normalizedInstagram) {
        console.warn('[test-send] ⚠️ Cannot save outgoing message: invalid Instagram username:', cleanInstagram);
        await prisma.$disconnect();
      } else {
        let client = await prisma.directClient.findUnique({
          where: { instagramUsername: normalizedInstagram },
        });
        
        // Якщо клієнта немає, спробуємо створити його
        if (!client) {
          console.log('[test-send] Client not found, attempting to create:', normalizedInstagram);
          try {
            const { getAllDirectStatuses } = await import('@/lib/direct-store');
            const statuses = await getAllDirectStatuses();
            const defaultStatus = statuses.find((s) => s.isDefault) || statuses[0];
            
            const now = new Date().toISOString();
            const clientId = `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            client = await prisma.directClient.create({
              data: {
                id: clientId,
                instagramUsername: normalizedInstagram,
                source: 'instagram',
                state: 'lead',
                firstContactDate: now,
                statusId: defaultStatus?.id || 'new',
                visitedSalon: false,
                signedUpForPaidService: false,
                createdAt: now,
                updatedAt: now,
              },
            });
            console.log('[test-send] ✅ Created new client for outgoing message:', client.id);
          } catch (createErr) {
            console.error('[test-send] Failed to create client for outgoing message:', createErr);
            await prisma.$disconnect();
            return {
              success: true,
              messageId,
            };
          }
        }
        
        if (client) {
          await prisma.directMessage.create({
            data: {
              clientId: client.id,
              direction: 'outgoing',
              text: message,
              messageId: messageId,
              subscriberId: finalSubscriberId,
              source: 'manychat',
              receivedAt: new Date(),
              rawData: JSON.stringify(sendData).substring(0, 10000), // Обмежуємо розмір
            },
          });
          console.log('[test-send] ✅ Outgoing message saved to database for client:', client.id);
        } else {
          console.warn('[test-send] ⚠️ Cannot save outgoing message: client is null');
        }
        
        await prisma.$disconnect();
      }
    } catch (dbErr) {
      console.error('[test-send] Failed to save outgoing message to DB:', dbErr);
      // Не зупиняємо виконання, просто логуємо
    }

    return {
      success: true,
      messageId,
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
    const { jobId, instagram, message, subscriberId: manualSubscriberId } = body;

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
    const result = await sendInstagramDM(job.instagram || instagram || '', formattedMessage, job, manualSubscriberId);

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
