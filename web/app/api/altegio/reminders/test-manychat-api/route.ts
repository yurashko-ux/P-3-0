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

    // Тест 3: findByCustomField з різними field_id
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

    return NextResponse.json({
      ok: true,
      instagram: cleanInstagram,
      found,
      successfulResults,
      allResults: results,
      summary: {
        totalTests: results.length,
        successful: successfulResults.length,
        failed: results.filter((r) => !r.ok || r.error).length,
      },
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

