// web/app/api/altegio/reminders/check-subscriber/route.ts
// Endpoint для перевірки, чи існує subscriber в ManyChat

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function findSubscriberInManyChat(instagram: string, apiKey: string, clientName?: string) {
  const results: any[] = [];

  // Видаляємо @ з початку, якщо є
  const cleanInstagram = instagram.startsWith('@') ? instagram.slice(1) : instagram;

  // Метод 1: findByName за Instagram username (без @)
  try {
    const nameSearchUrl = `https://api.manychat.com/fb/subscriber/findByName`;
    const nameSearchResponse = await fetch(nameSearchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cleanInstagram,
      }),
    });

    if (nameSearchResponse.ok) {
      const data = await nameSearchResponse.json();
      results.push({
        method: 'findByName',
        success: true,
        data: data,
        subscriberId: data?.data?.subscriber_id || data?.subscriber_id || data?.subscriber?.id,
      });
    } else {
      const errorText = await nameSearchResponse.text();
      results.push({
        method: 'findByName',
        success: false,
        error: `${nameSearchResponse.status}: ${errorText}`,
      });
    }
  } catch (err) {
    results.push({
      method: 'findByName',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Метод 2: findByCustomField (різні варіанти field_id)
  const customFieldIds = ['instagram_username', 'instagram', 'username', 'ig_username'];
  
  for (const fieldId of customFieldIds) {
    try {
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
        const data = await customSearchResponse.json();
        const subscriberId = data?.data?.subscriber_id || data?.subscriber_id || data?.subscriber?.id;
        if (subscriberId) {
          results.push({
            method: `findByCustomField (${fieldId})`,
            success: true,
            data: data,
            subscriberId: subscriberId,
          });
        }
      } else {
        const errorText = await customSearchResponse.text();
        // Не додаємо помилку, якщо це просто "not found"
        if (customSearchResponse.status !== 404) {
          results.push({
            method: `findByCustomField (${fieldId})`,
            success: false,
            error: `${customSearchResponse.status}: ${errorText}`,
          });
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
            message: 'Користувач не взаємодіяв з ManyChat ботом. Потрібно:',
            steps: [
              `1. Відкрий Instagram на акаунті @${instagram}`,
              '2. Знайди ManyChat бот (або сторінку, яка використовує ManyChat)',
              '3. Напиши будь-яке повідомлення боту',
              '4. Або натисни на кнопку в автоматизації ManyChat',
              '5. Після цього спробуй перевірити знову',
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

