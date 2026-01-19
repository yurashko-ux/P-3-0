// web/app/api/admin/direct/manychat-webhooks-table/route.ts
// API endpoint для отримання ManyChat webhook-ів у форматі таблиці

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';

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
 * Витягує дані з rawBody вебхука
 */
function extractDataFromRawBody(rawBody: string): { 
  username: string | null; 
  fullName: string | null; 
  text: string | null;
  subscriberId: string | null;
} {
  try {
    const parsed = JSON.parse(rawBody);
    
    const username = 
      parsed.username || 
      parsed.handle || 
      parsed.user_name || 
      parsed.instagram_username ||
      parsed?.subscriber?.username ||
      null;

    const subscriberId =
      parsed?.subscriber?.id ||
      parsed?.subscriber?.subscriber_id ||
      parsed?.subscriber_id ||
      parsed?.subscriberId ||
      null;
    
    const fullName = 
      parsed.full_name || 
      parsed.fullName || 
      parsed.fullname || 
      parsed.name ||
      (parsed.first_name && parsed.last_name ? `${parsed.first_name} ${parsed.last_name}` : null) ||
      null;
    
    const text = 
      parsed.text || 
      parsed.message || 
      parsed.last_input_text || 
      parsed.input ||
      null;
    
    return { username, fullName, text, subscriberId: subscriberId != null ? String(subscriberId) : null };
  } catch {
    // 1) Якщо це x-www-form-urlencoded — витягнемо з params
    try {
      const params = new URLSearchParams(rawBody);
      const username =
        params.get('username') ||
        params.get('handle') ||
        params.get('instagram_username') ||
        params.get('ig_username') ||
        null;
      const fullName =
        params.get('full_name') ||
        params.get('fullName') ||
        params.get('name') ||
        null;
      const text =
        params.get('text') ||
        params.get('message') ||
        params.get('last_input_text') ||
        params.get('input') ||
        null;
      const subscriberId =
        params.get('subscriber[id]') ||
        params.get('subscriber_id') ||
        params.get('subscriberId') ||
        params.get('subscriber.id') ||
        null;

      if (username || fullName || text || subscriberId) {
        return { username, fullName, text, subscriberId: subscriberId ? String(subscriberId) : null };
      }
    } catch {
      // ignore
    }

    // 2) Якщо не вдалося розпарсити, спробуємо знайти в рядку (JSON-подібний текст)
    try {
      const usernameMatch = rawBody.match(/"username"\s*:\s*"([^"]+)"/);
      const fullNameMatch = rawBody.match(/"full_name"\s*:\s*"([^"]+)"/);
      const textMatch = rawBody.match(/"text"\s*:\s*"([^"]+)"/);
      const subscriberIdMatch =
        rawBody.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*"([^"]+)"/i) ||
        rawBody.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*(\d+)/i) ||
        rawBody.match(/"subscriber_id"\s*:\s*"([^"]+)"/i) ||
        rawBody.match(/"subscriber_id"\s*:\s*(\d+)/i);
      
      return {
        username: usernameMatch ? usernameMatch[1] : null,
        fullName: fullNameMatch ? fullNameMatch[1] : null,
        text: textMatch ? textMatch[1] : null,
        subscriberId: subscriberIdMatch ? (subscriberIdMatch[1] || subscriberIdMatch[2] || null) : null,
      };
    } catch {
      return { username: null, fullName: null, text: null, subscriberId: null };
    }
  }
}

/**
 * GET - отримати ManyChat webhook-и у форматі таблиці
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 1000) : 100;
    const includeRaw = req.nextUrl.searchParams.get('includeRaw') === '1';

    // Отримуємо вебхуки
    const rawItems = await kvRead.lrange('manychat:webhook:log', 0, limit - 1);
    
    // Парсимо вебхуки
    const webhooks = rawItems
      .map((raw) => {
        try {
          let parsed: unknown = raw;
          
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw);
          } else if (raw && typeof raw === 'object') {
            const rawObj = raw as Record<string, unknown>;
            if ('value' in rawObj && typeof rawObj.value === 'string') {
              parsed = JSON.parse(rawObj.value);
            } else {
              parsed = raw;
            }
          }
          
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const parsedObj = parsed as Record<string, unknown>;
            
            // Якщо parsed має тільки поле "value", спробуємо розпарсити його ще раз
            const parsedKeys = Object.keys(parsedObj);
            if (parsedKeys.length === 1 && parsedKeys[0] === 'value' && typeof parsedObj.value === 'string') {
              try {
                const doubleParsed = JSON.parse(parsedObj.value);
                if (doubleParsed && typeof doubleParsed === 'object' && !Array.isArray(doubleParsed)) {
                  return doubleParsed as Record<string, unknown>;
                }
              } catch {
                // Якщо не вдалося розпарсити, продовжуємо з поточним parsedObj
              }
            }
            
            if ('receivedAt' in parsedObj) {
              return parsedObj;
            }
          }
          
          return null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    // Конвертуємо в формат таблиці
    const tableRows = webhooks
      .map((webhook) => {
        const receivedAt = webhook.receivedAt as string | undefined;
        const subscriberIdDirect = webhook.subscriberId as string | undefined;
        const rawBody = webhook.rawBody as string | undefined;
        const bodyLength = webhook.bodyLength as number | undefined;
        const headers = (webhook.headers as Record<string, unknown> | undefined) ?? undefined;
        
        if (!receivedAt) {
          return null;
        }

        // Витягуємо дані з rawBody
        const { username, fullName, text, subscriberId } = rawBody 
          ? extractDataFromRawBody(rawBody)
          : { username: null, fullName: null, text: null, subscriberId: null };

        return {
          receivedAt,
          instagramUsername: username,
          subscriberId: subscriberIdDirect || subscriberId,
          fullName: fullName || 'Невідомий клієнт',
          text: text || '-',
          bodyLength: bodyLength || 0,
          ...(includeRaw ? { rawBody: rawBody || null, headers: headers || null } : {}),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        // Сортуємо за датою вебхука (найновіші спочатку)
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      });

    return NextResponse.json({
      ok: true,
      total: tableRows.length,
      rows: tableRows,
    });
  } catch (error) {
    console.error('[direct/manychat-webhooks-table] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
