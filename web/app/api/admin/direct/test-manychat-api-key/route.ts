// web/app/api/admin/direct/test-manychat-api-key/route.ts
// Діагностичний endpoint для перевірки ManyChat API Key

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * GET - перевірити ManyChat API Key
 * Авторизація: через admin_token cookie або ?secret=CRON_SECRET
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ 
      error: 'Unauthorized',
      hint: 'Authenticate with admin_token cookie or add ?secret=CRON_SECRET parameter',
      authMethods: {
        cookie: 'Set admin_token cookie with value = ADMIN_PASS',
        secret: 'Add ?secret=CRON_SECRET to URL',
      },
    }, { status: 401 });
  }

  const envCheck = {
    MANYCHAT_API_KEY: {
      exists: !!process.env.MANYCHAT_API_KEY,
      length: process.env.MANYCHAT_API_KEY?.length || 0,
      preview: process.env.MANYCHAT_API_KEY?.substring(0, 10) + '...' || null,
    },
    ManyChat_API_Key: {
      exists: !!process.env.ManyChat_API_Key,
      length: process.env.ManyChat_API_Key?.length || 0,
      preview: process.env.ManyChat_API_Key?.substring(0, 10) + '...' || null,
    },
    MANYCHAT_API_TOKEN: {
      exists: !!process.env.MANYCHAT_API_TOKEN,
      length: process.env.MANYCHAT_API_TOKEN?.length || 0,
      preview: process.env.MANYCHAT_API_TOKEN?.substring(0, 10) + '...' || null,
    },
    MC_API_KEY: {
      exists: !!process.env.MC_API_KEY,
      length: process.env.MC_API_KEY?.length || 0,
      preview: process.env.MC_API_KEY?.substring(0, 10) + '...' || null,
    },
    MANYCHAT_APIKEY: {
      exists: !!process.env.MANYCHAT_APIKEY,
      length: process.env.MANYCHAT_APIKEY?.length || 0,
      preview: process.env.MANYCHAT_APIKEY?.substring(0, 10) + '...' || null,
    },
    // Всі змінні, що містять "manychat" або "api"
    allManyChatVars: Object.keys(process.env)
      .filter(key => /manychat|api.*key|mc.*key/i.test(key))
      .map(key => ({ 
        key, 
        exists: !!process.env[key], 
        length: process.env[key]?.length || 0,
        preview: process.env[key]?.substring(0, 10) + '...' || null,
      })),
  };

  // Знаходимо перший доступний ключ
  const foundKey = 
    process.env.MANYCHAT_API_KEY || 
    process.env.ManyChat_API_Key ||
    process.env.MANYCHAT_API_TOKEN || 
    process.env.MC_API_KEY ||
    process.env.MANYCHAT_APIKEY ||
    null;

  // Тестуємо API, якщо ключ знайдено
  let apiTest: any = null;
  if (foundKey) {
    const tests: any[] = [];
    
    // Тест 1: Старий формат (може не працювати)
    try {
      const testUrl1 = 'https://api.manychat.com/fb/subscriber/getSubscribers?page=1&limit=1';
      const testResponse1 = await fetch(testUrl1, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${foundKey}`,
        },
      });
      const responseText1 = await testResponse1.text();
      tests.push({
        url: testUrl1,
        status: testResponse1.status,
        statusText: testResponse1.statusText,
        ok: testResponse1.ok,
        responsePreview: responseText1.substring(0, 500),
      });
    } catch (err) {
      tests.push({
        url: 'https://api.manychat.com/fb/subscriber/getSubscribers',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 2: Новий формат API v2 (якщо існує)
    try {
      const testUrl2 = 'https://api.manychat.com/v2/subscribers?page=1&limit=1';
      const testResponse2 = await fetch(testUrl2, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${foundKey}`,
        },
      });
      const responseText2 = await testResponse2.text();
      tests.push({
        url: testUrl2,
        status: testResponse2.status,
        statusText: testResponse2.statusText,
        ok: testResponse2.ok,
        responsePreview: responseText2.substring(0, 500),
      });
    } catch (err) {
      tests.push({
        url: 'https://api.manychat.com/v2/subscribers',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 3: /v2.0/me (рекомендований ManyChat для тестування)
    try {
      const testUrl3 = 'https://api.manychat.com/v2.0/me';
      const testResponse3 = await fetch(testUrl3, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${foundKey}`,
        },
      });
      const responseText3 = await testResponse3.text();
      tests.push({
        url: testUrl3,
        method: 'GET',
        status: testResponse3.status,
        statusText: testResponse3.statusText,
        ok: testResponse3.ok,
        responsePreview: responseText3.substring(0, 500),
      });
    } catch (err) {
      tests.push({
        url: 'https://api.manychat.com/v2.0/me',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Тест 4: findByName (простий тест)
    try {
      const testUrl4 = 'https://api.manychat.com/fb/subscriber/findByName';
      const testResponse4 = await fetch(testUrl4, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${foundKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'test' }),
      });
      const responseText4 = await testResponse4.text();
      tests.push({
        url: testUrl4,
        method: 'POST',
        status: testResponse4.status,
        statusText: testResponse4.statusText,
        ok: testResponse4.ok,
        responsePreview: responseText4.substring(0, 500),
      });
    } catch (err) {
      tests.push({
        url: 'https://api.manychat.com/fb/subscriber/findByName',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    apiTest = { tests };
  }

  return NextResponse.json({
    ok: true,
    apiKeyFound: !!foundKey,
    apiKeyLength: foundKey?.length || 0,
    apiKeyPreview: foundKey ? foundKey.substring(0, 10) + '...' : null,
    envCheck,
    apiTest,
  });
}
