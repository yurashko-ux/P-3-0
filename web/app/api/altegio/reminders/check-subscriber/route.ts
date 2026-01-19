// web/app/api/altegio/reminders/check-subscriber/route.ts
// Endpoint для перевірки, чи існує subscriber в ManyChat

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function extractManychatCustomFields(customFieldsResponse: any): any[] {
  const d = customFieldsResponse;
  const candidates = [
    d?.data?.fields,
    d?.fields,
    d?.data,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function pickFieldId(field: any): string | null {
  const raw = field?.field_id ?? field?.id ?? field?.key ?? field?.name ?? null;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

async function findSubscriberInManyChat(instagram: string, apiKey: string) {
  const results: any[] = [];

  // Видаляємо @ з початку, якщо є
  const cleanInstagram = instagram.startsWith('@') ? instagram.slice(1) : instagram;

  // Метод 1: getSubscribers з фільтрацією за ig_username (системне поле ManyChat)
  try {
    const maxPages = 3; // Обмежуємо для діагностики
    const pageSize = 100;
    
    for (let page = 1; page <= maxPages; page++) {
      const subscribersUrl = `https://api.manychat.com/fb/subscriber/getSubscribers?page=${page}&limit=${pageSize}`;
      const subscribersResponse = await fetch(subscribersUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      
      if (subscribersResponse.ok) {
        const subscribersData = await subscribersResponse.json();
        const subscribers = subscribersData?.data || [];
        
        // Шукаємо subscriber з відповідним ig_username
        const foundSubscriber = subscribers.find((sub: any) => {
          const subIgUsername = sub.ig_username?.toLowerCase().trim();
          return subIgUsername === cleanInstagram.toLowerCase().trim();
        });
        
        if (foundSubscriber) {
          const subscriberId = foundSubscriber.id || foundSubscriber.subscriber_id;
          results.push({
            method: `getSubscribers (page ${page})`,
            success: true,
            data: foundSubscriber,
            subscriberId: subscriberId,
          });
          break;
        }
        
        // Якщо на цій сторінці менше ніж pageSize, це остання сторінка
        if (subscribers.length < pageSize) {
          break;
        }
      } else {
        const errorText = await subscribersResponse.text();
        results.push({
          method: `getSubscribers (page ${page})`,
          success: false,
          error: `${subscribersResponse.status}: ${errorText}`,
        });
        break;
      }
    }
  } catch (err) {
    results.push({
      method: 'getSubscribers',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Метод 2: findByCustomField - через реальні field_id з getCustomFields
  let customFields: any[] = [];
  try {
    const customFieldsUrl = `https://api.manychat.com/fb/page/getCustomFields`;
    const res = await fetch(customFieldsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      customFields = extractManychatCustomFields(data);
      results.push({
        method: 'getCustomFields',
        success: true,
        fieldsCount: customFields.length,
      });
    } else {
      results.push({
        method: 'getCustomFields',
        success: false,
        error: `${res.status}: ${text}`,
      });
    }
  } catch (err) {
    results.push({
      method: 'getCustomFields',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Вибираємо поля, які найбільш схожі на “instagram / ig”
  const instagramFields = customFields
    .map((f: any) => {
      const name = (f?.name ?? f?.title ?? f?.label ?? '').toString().toLowerCase();
      const key = (f?.key ?? f?.field_id ?? f?.id ?? '').toString().toLowerCase();
      const looksIg =
        name.includes('instagram') ||
        name.includes('insta') ||
        name.includes('ig') ||
        key.includes('instagram') ||
        key.includes('insta') ||
        key.includes('ig');
      return { f, looksIg };
    })
    .filter((x: any) => x.looksIg)
    .map((x: any) => x.f);

  const fieldsToTry = instagramFields.length > 0 ? instagramFields : customFields;
  const valuesToTry = [cleanInstagram, `@${cleanInstagram}`];

  for (const field of fieldsToTry) {
    // Якщо вже знайшли subscriber, зупиняємося
    if (results.some((r) => r.success && r.subscriberId)) break;

    const fieldId = pickFieldId(field);
    if (!fieldId) continue;

    try {
      const customSearchUrl = `https://api.manychat.com/fb/subscriber/findByCustomField`;

      for (const fieldValue of valuesToTry) {
        if (results.some((r) => r.success && r.subscriberId)) break;

        // У твоєму акаунті ManyChat повертає 405 на POST, тому спочатку пробуємо GET з query params
        const getUrl = `${customSearchUrl}?field_id=${encodeURIComponent(fieldId)}&field_value=${encodeURIComponent(fieldValue)}`;
        let customSearchResponse = await fetch(getUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        // fallback: якщо раптом GET не підтримується — пробуємо POST
        if (customSearchResponse.status === 405) {
          customSearchResponse = await fetch(customSearchUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              field_id: fieldId,
              field_value: fieldValue,
            }),
          });
        }

        if (customSearchResponse.ok) {
          const data = await customSearchResponse.json();
          const subscriberId = data?.data?.subscriber_id || data?.subscriber_id || data?.subscriber?.id;
          results.push({
            method: `findByCustomField (${fieldId} = ${fieldValue})`,
            success: Boolean(subscriberId),
            subscriberId: subscriberId || null,
          });
          if (subscriberId) break;
        } else {
          const errorText = await customSearchResponse.text();
          // Логуємо 400/401/403/429 як корисні, а "не знайдено" не засмічуємо
          if (customSearchResponse.status !== 404) {
            results.push({
              method: `findByCustomField (${fieldId} = ${fieldValue})`,
              success: false,
              error: `${customSearchResponse.status}: ${errorText}`,
            });
          }
        }
      }
    } catch (err) {
      // Ігноруємо помилки для custom fields
    }
  }

  return results;
}

export async function GET(req: NextRequest) {
  try {
    const instagramRaw = req.nextUrl.searchParams.get('instagram') || 'mykolayyurashko';
    // Видаляємо @ з початку, якщо є
    const instagram = instagramRaw.startsWith('@') ? instagramRaw.slice(1) : instagramRaw;
    
    // Отримуємо API Key
    const manychatApiKey = 
      process.env.MANYCHAT_API_KEY || 
      process.env.ManyChat_API_Key ||
      process.env.MANYCHAT_API_TOKEN || 
      process.env.MC_API_KEY ||
      process.env.MANYCHAT_APIKEY;

    if (!manychatApiKey) {
      return NextResponse.json({
        ok: false,
        error: 'ManyChat API Key not configured',
        diagnostics: {
          checkedVariables: [
            'MANYCHAT_API_KEY',
            'ManyChat_API_Key',
            'MANYCHAT_API_TOKEN',
            'MC_API_KEY',
            'MANYCHAT_APIKEY',
          ],
        },
      });
    }

    // Шукаємо subscriber за Instagram username (без @)
    const results = await findSubscriberInManyChat(instagram, manychatApiKey);
    
    const found = results.some((r) => r.success && r.subscriberId);
    const subscriberId = results.find((r) => r.success && r.subscriberId)?.subscriberId;

    return NextResponse.json({
      ok: true,
      instagram, // Повертаємо без @
      found,
      subscriberId: subscriberId || null,
      results,
      instructions: found 
        ? {
            status: '✅ Subscriber знайдено!',
            message: `Subscriber ID: ${subscriberId}. Тепер можна відправляти повідомлення.`,
          }
        : {
            status: '❌ Subscriber не знайдено',
            message:
              'Не вдалося знайти subscriber через ManyChat API. Це НЕ обовʼязково означає, що користувач не писав боту — частіше це означає, що Instagram handle збережений в іншому custom field або у іншому форматі.',
            steps: [
              '1. В ManyChat відкрий Contacts → знайди цього користувача (якщо знаєш імʼя/номер/ID)',
              `2. Перевір, де саме збережений Instagram username (@${instagram}) — в якому custom field (і як називається поле)`,
              `3. Запусти діагностику custom fields: https://p-3-0.vercel.app/api/altegio/reminders/test-manychat-detailed?instagram=${encodeURIComponent(instagram)}`,
              `4. Після цього повтори перевірку: https://p-3-0.vercel.app/api/altegio/reminders/check-subscriber?instagram=${encodeURIComponent(instagram)}`,
            ],
          },
    });
  } catch (error) {
    console.error('[check-subscriber] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

