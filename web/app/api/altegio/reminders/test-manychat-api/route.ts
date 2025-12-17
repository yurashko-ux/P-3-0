// web/app/api/altegio/reminders/test-manychat-api/route.ts
// Endpoint для тестування ManyChat API та діагностики пошуку subscriber

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const instagram = req.nextUrl.searchParams.get('instagram') || 'mykolayyurashko';
    const cleanInstagram = instagram.startsWith('@') ? instagram.slice(1) : instagram;
    
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
      });
    }

    const results: any[] = [];

    // Тест 1: findByName
    try {
      console.log(`[test-manychat-api] Testing findByName with: ${cleanInstagram}`);
      const nameSearchUrl = `https://api.manychat.com/fb/subscriber/findByName`;
      const nameSearchResponse = await fetch(nameSearchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: cleanInstagram,
        }),
      });

      const nameResponseText = await nameSearchResponse.text();
      let nameResponseData: any = null;
      try {
        nameResponseData = JSON.parse(nameResponseText);
      } catch {
        nameResponseData = nameResponseText;
      }

      results.push({
        method: 'findByName',
        status: nameSearchResponse.status,
        ok: nameSearchResponse.ok,
        response: nameResponseData,
        subscriberId: nameResponseData?.data?.subscriber_id || nameResponseData?.subscriber_id || nameResponseData?.subscriber?.id,
      });
    } catch (err) {
      results.push({
        method: 'findByName',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 2: Отримуємо список custom fields (якщо API підтримує)
    try {
      console.log(`[test-manychat-api] Trying to get custom fields list`);
      const customFieldsUrl = `https://api.manychat.com/fb/subscriber/getCustomFields`;
      const customFieldsResponse = await fetch(customFieldsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const fieldsResponseText = await customFieldsResponse.text();
      let fieldsResponseData: any = null;
      try {
        fieldsResponseData = JSON.parse(fieldsResponseText);
      } catch {
        fieldsResponseData = fieldsResponseText;
      }

      results.push({
        method: 'getCustomFields',
        status: customFieldsResponse.status,
        ok: customFieldsResponse.ok,
        response: fieldsResponseData,
      });
    } catch (err) {
      results.push({
        method: 'getCustomFields',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 3: getSubscribers з фільтрацією за ig_username
    try {
      console.log(`[test-manychat-api] Testing getSubscribers with ig_username filter`);
      const maxPages = 3; // Обмежуємо для діагностики
      const pageSize = 100;
      let foundViaGetSubscribers = false;
      
      for (let page = 1; page <= maxPages; page++) {
        const subscribersUrl = `https://api.manychat.com/fb/subscriber/getSubscribers?page=${page}&limit=${pageSize}`;
        const subscribersResponse = await fetch(subscribersUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${manychatApiKey}`,
          },
        });
        
        if (subscribersResponse.ok) {
          const subscribersData = await subscribersResponse.json();
          const subscribers = subscribersData?.data || [];
          
          // Логуємо структуру першого subscriber для діагностики
          if (page === 1 && subscribers.length > 0) {
            const firstSub = subscribers[0];
            console.log(`[test-manychat-api] Sample subscriber from getSubscribers:`, {
              id: firstSub.id,
              name: firstSub.name,
              ig_username: firstSub.ig_username,
              has_ig_username: !!firstSub.ig_username,
              keys: Object.keys(firstSub).slice(0, 15),
            });
          }
          
          // Шукаємо subscriber з відповідним ig_username
          const foundSubscriber = subscribers.find((sub: any) => {
            const subIgUsername = sub.ig_username?.toLowerCase().trim();
            return subIgUsername === cleanInstagram.toLowerCase().trim();
          });
          
          if (foundSubscriber) {
            foundViaGetSubscribers = true;
            results.push({
              method: `getSubscribers (page ${page})`,
              status: subscribersResponse.status,
              ok: true,
              response: {
                found: true,
                subscriber: foundSubscriber,
                totalOnPage: subscribers.length,
              },
              subscriberId: foundSubscriber.id || foundSubscriber.subscriber_id,
            });
            break;
          }
          
          // Якщо на цій сторінці менше ніж pageSize, це остання сторінка
          if (subscribers.length < pageSize) {
            results.push({
              method: `getSubscribers (page ${page})`,
              status: subscribersResponse.status,
              ok: true,
              response: {
                found: false,
                totalOnPage: subscribers.length,
                isLastPage: true,
              },
            });
            break;
          }
        } else {
          const errorText = await subscribersResponse.text();
          results.push({
            method: `getSubscribers (page ${page})`,
            status: subscribersResponse.status,
            ok: false,
            error: errorText.substring(0, 200),
          });
          break;
        }
      }
      
      if (!foundViaGetSubscribers) {
        results.push({
          method: 'getSubscribers (summary)',
          status: 200,
          ok: true,
          response: {
            found: false,
            message: `Checked up to ${maxPages} pages, subscriber not found`,
          },
        });
      }
    } catch (err) {
      results.push({
        method: 'getSubscribers',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    
    // Тест 4: Спробуємо знайти через Instagram handle напряму
    try {
      console.log(`[test-manychat-api] Trying to find by Instagram handle`);
      // ManyChat може мати спеціальний endpoint для Instagram
      const instagramSearchUrl = `https://api.manychat.com/fb/subscriber/findByInstagram`;
      const instagramSearchResponse = await fetch(instagramSearchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instagram: cleanInstagram,
        }),
      });

      const instagramResponseText = await instagramSearchResponse.text();
      let instagramResponseData: any = null;
      try {
        instagramResponseData = JSON.parse(instagramResponseText);
      } catch {
        instagramResponseData = instagramResponseText;
      }

      results.push({
        method: 'findByInstagram',
        status: instagramSearchResponse.status,
        ok: instagramSearchResponse.ok,
        response: instagramResponseData,
        subscriberId: instagramResponseData?.data?.subscriber_id || instagramResponseData?.subscriber_id || instagramResponseData?.subscriber?.id,
      });
    } catch (err) {
      results.push({
        method: 'findByInstagram',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 5: findByCustomField з різними field_id
    const customFieldIds = ['instagram_username', 'instagram', 'username', 'ig_username', 'Instagram Username', 'Instagram'];
    
    for (const fieldId of customFieldIds) {
      try {
        console.log(`[test-manychat-api] Testing findByCustomField with field_id: ${fieldId}`);
        const customSearchUrl = `https://api.manychat.com/fb/subscriber/findByCustomField`;
        const customSearchResponse = await fetch(customSearchUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${manychatApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            field_id: fieldId,
            field_value: cleanInstagram,
          }),
        });

        const customResponseText = await customSearchResponse.text();
        let customResponseData: any = null;
        try {
          customResponseData = JSON.parse(customResponseText);
        } catch {
          customResponseData = customResponseText;
        }

        results.push({
          method: `findByCustomField (${fieldId})`,
          status: customSearchResponse.status,
          ok: customSearchResponse.ok,
          response: customResponseData,
          subscriberId: customResponseData?.data?.subscriber_id || customResponseData?.subscriber_id || customResponseData?.subscriber?.id,
        });
      } catch (err) {
        results.push({
          method: `findByCustomField (${fieldId})`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Знаходимо успішні результати
    const successfulResults = results.filter((r) => r.ok && r.subscriberId);
    const found = successfulResults.length > 0;
    
    // Якщо знайшли через getCustomFields, спробуємо використати правильний field_id
    const customFieldsResult = results.find((r) => r.method === 'getCustomFields' && r.ok && r.response);
    if (customFieldsResult && customFieldsResult.response) {
      const fields = customFieldsResult.response.data?.fields || customFieldsResult.response.fields || [];
      console.log(`[test-manychat-api] Found ${fields.length} custom fields`);
      
      // Шукаємо поле, яке може містити Instagram username
      const instagramFields = fields.filter((f: any) => 
        f.name?.toLowerCase().includes('instagram') || 
        f.field_id?.toLowerCase().includes('instagram') ||
        f.label?.toLowerCase().includes('instagram')
      );
      
      if (instagramFields.length > 0) {
        console.log(`[test-manychat-api] Found Instagram-related fields:`, instagramFields);
        
        // Тестуємо кожне знайдене поле
        for (const field of instagramFields) {
          const fieldId = field.field_id || field.id || field.name;
          try {
            console.log(`[test-manychat-api] Testing custom field: ${fieldId}`);
            const customSearchUrl = `https://api.manychat.com/fb/subscriber/findByCustomField`;
            const customSearchResponse = await fetch(customSearchUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${manychatApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                field_id: fieldId,
                field_value: cleanInstagram,
              }),
            });

            const customResponseText = await customSearchResponse.text();
            let customResponseData: any = null;
            try {
              customResponseData = JSON.parse(customResponseText);
            } catch {
              customResponseData = customResponseText;
            }

            results.push({
              method: `findByCustomField (from getCustomFields: ${fieldId})`,
              status: customSearchResponse.status,
              ok: customSearchResponse.ok,
              response: customResponseData,
              subscriberId: customResponseData?.data?.subscriber_id || customResponseData?.subscriber_id || customResponseData?.subscriber?.id,
            });
          } catch (err) {
            // Ігноруємо помилки
          }
        }
      }
    }

    // Оновлюємо результати після додаткових тестів
    const finalSuccessfulResults = results.filter((r) => r.ok && r.subscriberId);
    const finalFound = finalSuccessfulResults.length > 0;

    return NextResponse.json({
      ok: true,
      instagram: cleanInstagram,
      found: finalFound,
      successfulResults: finalSuccessfulResults,
      allResults: results,
      summary: {
        totalTests: results.length,
        successful: finalSuccessfulResults.length,
        failed: results.filter((r) => !r.ok || r.error).length,
      },
      recommendations: finalFound ? [] : [
        '1. Переконайся, що @' + cleanInstagram + ' взаємодіяв з ManyChat ботом (написав повідомлення)',
        '2. Перевір в ManyChat Dashboard → Contacts, чи є там цей контакт',
        '3. Якщо контакт є, перевір, чи правильно збережений Instagram username в custom fields',
        '4. Можливо, потрібно використати числовий field_id замість назви поля',
      ],
    });
  } catch (error) {
    console.error('[test-manychat-api] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

