// web/app/api/altegio/reminders/test-manychat-detailed/route.ts
// Детальний тест ManyChat API з повним логуванням

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
        availableEnvVars: [
          'MANYCHAT_API_KEY',
          'ManyChat_API_Key',
          'MANYCHAT_API_TOKEN',
          'MC_API_KEY',
          'MANYCHAT_APIKEY',
        ],
      });
    }

    // Перевіряємо формат API key
    const apiKeyInfo = {
      length: manychatApiKey.length,
      startsWith: manychatApiKey.substring(0, 10) + '...',
      hasColon: manychatApiKey.includes(':'),
      parts: manychatApiKey.split(':').length,
    };

    const results: any[] = [];

    // Тест 1: findByName - спробуємо GET з query параметрами
    try {
      console.log(`[test-detailed] ===== TEST 1: findByName (GET) =====`);
      console.log(`[test-detailed] Instagram: ${cleanInstagram}`);
      console.log(`[test-detailed] API Key length: ${manychatApiKey.length}`);
      
      const nameSearchUrl = `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(cleanInstagram)}`;
      
      console.log(`[test-detailed] URL: ${nameSearchUrl}`);
      console.log(`[test-detailed] Headers:`, {
        'Authorization': `Bearer ${manychatApiKey.substring(0, 10)}...`,
      });

      const nameSearchResponse = await fetch(nameSearchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
        },
      });

      const nameResponseText = await nameSearchResponse.text();
      console.log(`[test-detailed] Response status: ${nameSearchResponse.status}`);
      // Логуємо headers через Array.from для сумісності з TypeScript
      const headersObj: Record<string, string> = {};
      nameSearchResponse.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      console.log(`[test-detailed] Response headers:`, headersObj);
      console.log(`[test-detailed] Response text (first 500 chars):`, nameResponseText.substring(0, 500));

      let nameResponseData: any = null;
      try {
        nameResponseData = JSON.parse(nameResponseText);
        console.log(`[test-detailed] Response JSON:`, JSON.stringify(nameResponseData, null, 2));
      } catch (e) {
        console.log(`[test-detailed] Response is not JSON:`, e);
        nameResponseData = nameResponseText;
      }

      const extractedSubscriberId = 
        nameResponseData?.data?.subscriber_id || 
        nameResponseData?.subscriber_id || 
        nameResponseData?.subscriber?.id ||
        nameResponseData?.data?.id ||
        nameResponseData?.id;

      results.push({
        method: 'findByName',
        status: nameSearchResponse.status,
        statusText: nameSearchResponse.statusText,
        ok: nameSearchResponse.ok,
        request: {
          url: nameSearchUrl,
          method: 'GET',
        },
        response: {
          raw: nameResponseText,
          parsed: nameResponseData,
          subscriberId: extractedSubscriberId,
        },
        headers: (() => {
          const headersObj: Record<string, string> = {};
          nameSearchResponse.headers.forEach((value, key) => {
            headersObj[key] = value;
          });
          return headersObj;
        })(),
      });
    } catch (err) {
      console.error(`[test-detailed] findByName error:`, err);
      results.push({
        method: 'findByName',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Тест 1.5: findByInstagram - якщо username видно як “Opted‑In for Instagram”, але custom fields пусті
    try {
      console.log(`[test-detailed] ===== TEST 1.5: findByInstagram (POST/GET) =====`);
      const url = `https://api.manychat.com/fb/subscriber/findByInstagram`;
      console.log(`[test-detailed] URL: ${url}`);
      console.log(`[test-detailed] Body:`, JSON.stringify({ instagram: cleanInstagram }));

      let res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instagram: cleanInstagram }),
      });
      let text = await res.text();
      let usedMethod: 'POST' | 'GET' = 'POST';
      let usedUrl = url;

      if (res.status === 405) {
        usedMethod = 'GET';
        usedUrl = `${url}?instagram=${encodeURIComponent(cleanInstagram)}`;
        console.log(`[test-detailed] POST returned 405, retrying GET: ${usedUrl}`);
        res = await fetch(usedUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${manychatApiKey}` },
        });
        text = await res.text();
      }

      console.log(`[test-detailed] Response status: ${res.status}`);
      console.log(`[test-detailed] Response text (first 500 chars):`, text.substring(0, 500));

      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = text; }

      const extractedSubscriberId =
        parsed?.data?.subscriber_id ||
        parsed?.subscriber_id ||
        parsed?.subscriber?.id ||
        parsed?.data?.id ||
        parsed?.id;

      results.push({
        method: 'findByInstagram',
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        request: {
          url: usedUrl,
          method: usedMethod,
          body: usedMethod === 'POST' ? { instagram: cleanInstagram } : undefined,
        },
        response: {
          raw: text,
          parsed,
          subscriberId: extractedSubscriberId,
        },
      });
    } catch (err) {
      console.error(`[test-detailed] findByInstagram error:`, err);
      results.push({
        method: 'findByInstagram',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Тест 2: getCustomFields - детальний лог
    try {
      console.log(`[test-detailed] ===== TEST 2: getCustomFields =====`);
      const customFieldsUrl = `https://api.manychat.com/fb/subscriber/getCustomFields`;
      
      console.log(`[test-detailed] URL: ${customFieldsUrl}`);

      const customFieldsResponse = await fetch(customFieldsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const fieldsResponseText = await customFieldsResponse.text();
      console.log(`[test-detailed] Response status: ${customFieldsResponse.status}`);
      console.log(`[test-detailed] Response text (first 1000 chars):`, fieldsResponseText.substring(0, 1000));

      let fieldsResponseData: any = null;
      try {
        fieldsResponseData = JSON.parse(fieldsResponseText);
        console.log(`[test-detailed] Response JSON:`, JSON.stringify(fieldsResponseData, null, 2));
      } catch (e) {
        fieldsResponseData = fieldsResponseText;
      }

      const fields = fieldsResponseData?.data?.fields || fieldsResponseData?.fields || [];
      const instagramFields = fields.filter((f: any) => 
        f.name?.toLowerCase().includes('instagram') || 
        f.field_id?.toLowerCase().includes('instagram') ||
        f.label?.toLowerCase().includes('instagram') ||
        f.id?.toString().includes('instagram')
      );

      results.push({
        method: 'getCustomFields',
        status: customFieldsResponse.status,
        statusText: customFieldsResponse.statusText,
        ok: customFieldsResponse.ok,
        response: {
          raw: fieldsResponseText,
          parsed: fieldsResponseData,
          totalFields: fields.length,
          instagramFields: instagramFields,
        },
      });
    } catch (err) {
      console.error(`[test-detailed] getCustomFields error:`, err);
      results.push({
        method: 'getCustomFields',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 3: findByCustomField з реальними field_id з getCustomFields
    const customFieldsResult = results.find((r) => r.method === 'getCustomFields' && r.ok);
    if (customFieldsResult && customFieldsResult.response?.instagramFields) {
      const instagramFields = customFieldsResult.response.instagramFields;
      console.log(`[test-detailed] ===== TEST 3: findByCustomField with real fields =====`);
      console.log(`[test-detailed] Found ${instagramFields.length} Instagram-related fields`);

      for (const field of instagramFields) {
        const fieldId = field.field_id || field.id || field.name;
        try {
          console.log(`[test-detailed] Testing field: ${JSON.stringify(field, null, 2)}`);
          const customSearchUrl = `https://api.manychat.com/fb/subscriber/findByCustomField`;
          const requestBody = {
            field_id: fieldId,
            field_value: cleanInstagram,
          };

          console.log(`[test-detailed] Request body:`, JSON.stringify(requestBody, null, 2));

          const customSearchResponse = await fetch(customSearchUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${manychatApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          const customResponseText = await customSearchResponse.text();
          console.log(`[test-detailed] Response status: ${customSearchResponse.status}`);
          console.log(`[test-detailed] Response text:`, customResponseText.substring(0, 500));

          let customResponseData: any = null;
          try {
            customResponseData = JSON.parse(customResponseText);
          } catch {
            customResponseData = customResponseText;
          }

          const extractedSubscriberId = 
            customResponseData?.data?.subscriber_id || 
            customResponseData?.subscriber_id || 
            customResponseData?.subscriber?.id;

          results.push({
            method: `findByCustomField (${fieldId})`,
            status: customSearchResponse.status,
            statusText: customSearchResponse.statusText,
            ok: customSearchResponse.ok,
            request: {
              url: customSearchUrl,
              body: requestBody,
              field: field,
            },
            response: {
              raw: customResponseText,
              parsed: customResponseData,
              subscriberId: extractedSubscriberId,
            },
          });
        } catch (err) {
          console.error(`[test-detailed] findByCustomField error for ${fieldId}:`, err);
          results.push({
            method: `findByCustomField (${fieldId})`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Тест 4: Спробуємо знайти за повним ім'ям (якщо є) - GET метод
    try {
      console.log(`[test-detailed] ===== TEST 4: findByName with full name (GET) =====`);
      // Можливо, ManyChat зберігає повне ім'я, спробуємо знайти за ним
      const fullNameSearchUrl = `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent('Микола Юрашко')}`;
      
      console.log(`[test-detailed] URL: ${fullNameSearchUrl}`);

      const fullNameSearchResponse = await fetch(fullNameSearchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${manychatApiKey}`,
        },
      });

      const fullNameResponseText = await fullNameSearchResponse.text();
      console.log(`[test-detailed] Response status: ${fullNameSearchResponse.status}`);
      console.log(`[test-detailed] Response text:`, fullNameResponseText.substring(0, 500));

      let fullNameResponseData: any = null;
      try {
        fullNameResponseData = JSON.parse(fullNameResponseText);
      } catch {
        fullNameResponseData = fullNameResponseText;
      }

      const extractedSubscriberId = 
        fullNameResponseData?.data?.subscriber_id || 
        fullNameResponseData?.subscriber_id || 
        fullNameResponseData?.subscriber?.id;

      results.push({
        method: 'findByName (full name)',
        status: fullNameSearchResponse.status,
        statusText: fullNameSearchResponse.statusText,
        ok: fullNameSearchResponse.ok,
        request: {
          url: fullNameSearchUrl,
          method: 'GET',
        },
        response: {
          raw: fullNameResponseText,
          parsed: fullNameResponseData,
          subscriberId: extractedSubscriberId,
        },
      });
    } catch (err) {
      console.error(`[test-detailed] findByName (full name) error:`, err);
      results.push({
        method: 'findByName (full name)',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Підсумок
    const successfulResults = results.filter((r) => r.ok && r.response?.subscriberId);
    const found = successfulResults.length > 0;

    return NextResponse.json({
      ok: true,
      instagram: cleanInstagram,
      apiKeyInfo,
      found,
      successfulResults: successfulResults.map((r) => ({
        method: r.method,
        subscriberId: r.response?.subscriberId,
      })),
      allResults: results,
      summary: {
        totalTests: results.length,
        successful: successfulResults.length,
        failed: results.filter((r) => !r.ok || r.error).length,
      },
      recommendations: found ? [] : [
        '1. Перевір, чи @' + cleanInstagram + ' взаємодіяв з ManyChat ботом (написав повідомлення)',
        '2. Перевір в ManyChat Dashboard → Contacts, чи є там цей контакт',
        '3. Якщо контакт є, перевір, як саме збережений Instagram username в ManyChat',
        '4. Можливо, потрібно використати числовий field_id замість назви поля',
        '5. Перевір логи Vercel для детальної інформації про всі запити',
      ],
    });
  } catch (error) {
    console.error('[test-detailed] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}

