// web/app/api/admin/direct/messages-history/route.ts
// API endpoint для отримання історії повідомлень ManyChat для клієнта

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';

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
} {
  try {
    const parsed = JSON.parse(rawBody);
    
    const username = 
      parsed.username || 
      parsed.handle || 
      parsed.user_name || 
      parsed.instagram_username ||
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
    
    return { username, fullName, text };
  } catch {
    try {
      const usernameMatch = rawBody.match(/"username"\s*:\s*"([^"]+)"/);
      const fullNameMatch = rawBody.match(/"full_name"\s*:\s*"([^"]+)"/);
      const textMatch = rawBody.match(/"text"\s*:\s*"([^"]+)"/);
      
      return {
        username: usernameMatch ? usernameMatch[1] : null,
        fullName: fullNameMatch ? fullNameMatch[1] : null,
        text: textMatch ? textMatch[1] : null,
      };
    } catch {
      return { username: null, fullName: null, text: null };
    }
  }
}


/**
 * GET - отримати історію повідомлень ManyChat для клієнта
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const instagramUsername = req.nextUrl.searchParams.get('instagramUsername');
    
    if (!clientId && !instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'clientId or instagramUsername is required' },
        { status: 400 }
      );
    }

    // Отримуємо всі вебхуки (до 1000)
    const rawItems = await kvRead.lrange('manychat:webhook:log', 0, 999);
    
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

    // Фільтруємо вебхуки для цього клієнта
    const clientWebhooks = webhooks
      .map((webhook) => {
        const receivedAt = webhook.receivedAt as string | undefined;
        const rawBody = webhook.rawBody as string | undefined;
        
        if (!receivedAt || !rawBody) {
          return null;
        }

        // Витягуємо дані з rawBody
        const { username, fullName, text } = extractDataFromRawBody(rawBody);
        
        if (!username) {
          return null;
        }

        // Нормалізуємо для порівняння
        const normalizedUsername = normalizeInstagram(username);
        
        // Перевіряємо, чи це повідомлення від цього клієнта
        let matches = false;
        if (instagramUsername) {
          const normalizedClientUsername = normalizeInstagram(instagramUsername);
          matches = normalizedUsername === normalizedClientUsername;
        }
        
        // Якщо не знайшли по username, пропускаємо
        if (!matches) {
          return null;
        }

        return {
          receivedAt,
          text: text || '-',
          fullName: fullName || 'Невідомий клієнт',
          username: normalizedUsername,
        };
      })
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
      .sort((a, b) => {
        // Сортуємо за датою (найновіші спочатку)
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      });

    return NextResponse.json({
      ok: true,
      total: clientWebhooks.length,
      messages: clientWebhooks,
    });
  } catch (error) {
    console.error('[direct/messages-history] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
