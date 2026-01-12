// web/app/api/admin/direct/test-keycrm-messages/route.ts
// Тестовий endpoint для перевірки KeyCRM API на наявність endpoint'ів для повідомлень

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
 * GET - перевірка всіх можливих KeyCRM endpoint'ів для повідомлень
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base =
    process.env.KEYCRM_BASE_URL ||
    process.env.KEYCRM_API_URL ||
    process.env.KEYCRM_URL ||
    '';
  const token =
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_BEARER ||
    '';

  if (!base || !token) {
    return NextResponse.json({
      ok: false,
      error: 'KeyCRM not configured',
      need: {
        KEYCRM_BASE_URL_or_ALTS: !!base,
        KEYCRM_TOKEN_or_BEARER: !!token,
      },
    }, { status: 500 });
  }

  const auth = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
  
  // Список можливих endpoint'ів для перевірки
  const endpoints = [
    'messages',
    'conversations',
    'chats',
    'communications',
    'activities',
    'messages?page=1&limit=10',
    'conversations?page=1&limit=10',
  ];

  const results: Array<{
    endpoint: string;
    status: number;
    ok: boolean;
    error?: string;
    hasData?: boolean;
    dataPreview?: any;
  }> = [];

  // Перевіряємо кожен endpoint
  for (const path of endpoints) {
    try {
      const target = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
      const response = await fetch(target, {
        method: 'GET',
        headers: {
          Authorization: auth,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { text: text.substring(0, 200) };
      }

      const hasData = parsed?.data && Array.isArray(parsed.data) && parsed.data.length > 0;
      const hasMessages = parsed?.messages && Array.isArray(parsed.messages) && parsed.messages.length > 0;
      const hasItems = parsed?.items && Array.isArray(parsed.items) && parsed.items.length > 0;

      results.push({
        endpoint: path,
        status: response.status,
        ok: response.ok,
        error: response.ok ? undefined : (parsed?.error || parsed?.message || text.substring(0, 100)),
        hasData: hasData || hasMessages || hasItems,
        dataPreview: response.ok && (hasData || hasMessages || hasItems)
          ? {
              count: parsed?.data?.length || parsed?.messages?.length || parsed?.items?.length || 0,
              firstItem: parsed?.data?.[0] || parsed?.messages?.[0] || parsed?.items?.[0] || null,
              structure: Object.keys(parsed || {}).slice(0, 10),
            }
          : undefined,
      });
    } catch (error) {
      results.push({
        endpoint: path,
        status: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Перевіряємо також через картки (якщо є card_id в query)
  const cardId = req.nextUrl.searchParams.get('card_id');
  if (cardId) {
    const cardEndpoints = [
      `cards/${cardId}/messages`,
      `cards/${cardId}?include[]=messages`,
      `cards/${cardId}/conversations`,
    ];

    for (const path of cardEndpoints) {
      try {
        const target = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
        const response = await fetch(target, {
          method: 'GET',
          headers: {
            Authorization: auth,
            Accept: 'application/json',
          },
          cache: 'no-store',
        });

        const text = await response.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { text: text.substring(0, 200) };
        }

        const hasData = parsed?.data && Array.isArray(parsed.data) && parsed.data.length > 0;
        const hasMessages = parsed?.messages && Array.isArray(parsed.messages) && parsed.messages.length > 0;

        results.push({
          endpoint: path,
          status: response.status,
          ok: response.ok,
          error: response.ok ? undefined : (parsed?.error || parsed?.message || text.substring(0, 100)),
          hasData: hasData || hasMessages,
          dataPreview: response.ok && (hasData || hasMessages)
            ? {
                count: parsed?.data?.length || parsed?.messages?.length || 0,
                firstItem: parsed?.data?.[0] || parsed?.messages?.[0] || null,
                structure: Object.keys(parsed || {}).slice(0, 10),
              }
            : undefined,
        });
      } catch (error) {
        results.push({
          endpoint: path,
          status: 0,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const workingEndpoints = results.filter(r => r.ok && r.hasData);
  const existingEndpoints = results.filter(r => r.ok);
  const notFoundEndpoints = results.filter(r => !r.ok && r.status === 404);

  return NextResponse.json({
    ok: true,
    summary: {
      total: results.length,
      working: workingEndpoints.length,
      existing: existingEndpoints.length,
      notFound: notFoundEndpoints.length,
    },
    workingEndpoints: workingEndpoints.map(r => ({
      endpoint: r.endpoint,
      status: r.status,
      dataPreview: r.dataPreview,
    })),
    allResults: results,
    config: {
      baseUrl: base,
      tokenConfigured: !!token,
      tokenLength: token.length,
    },
    note: workingEndpoints.length > 0
      ? `Знайдено ${workingEndpoints.length} робочих endpoint'ів для повідомлень!`
      : 'Робочі endpoint'и не знайдено. Перевірте документацію KeyCRM API.',
  });
}
