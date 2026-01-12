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
    try {
      // Простий тест - отримуємо список subscribers (перша сторінка)
      const testUrl = 'https://api.manychat.com/fb/subscriber/getSubscribers?page=1&limit=1';
      const testResponse = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${foundKey}`,
        },
      });

      apiTest = {
        status: testResponse.status,
        statusText: testResponse.statusText,
        ok: testResponse.ok,
        responsePreview: (await testResponse.text()).substring(0, 500),
      };
    } catch (err) {
      apiTest = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
