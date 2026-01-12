// web/app/api/admin/direct/manychat-conversation/route.ts
// API endpoint для отримання повної історії переписки з ManyChat API

import { NextRequest, NextResponse } from 'next/server';
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
 * Отримує ManyChat API ключ
 */
function getManyChatApiKey(): string | null {
  const key = (
    process.env.MANYCHAT_API_KEY || 
    process.env.ManyChat_API_Key ||
    process.env.MANYCHAT_API_TOKEN || 
    process.env.MC_API_KEY ||
    process.env.MANYCHAT_APIKEY ||
    null
  );
  
  // Діагностика для дебагу
  if (!key) {
    console.log('[manychat-conversation] API Key not found. Available env vars:', {
      MANYCHAT_API_KEY: !!process.env.MANYCHAT_API_KEY,
      ManyChat_API_Key: !!process.env.ManyChat_API_Key,
      MANYCHAT_API_TOKEN: !!process.env.MANYCHAT_API_TOKEN,
      MC_API_KEY: !!process.env.MC_API_KEY,
      MANYCHAT_APIKEY: !!process.env.MANYCHAT_APIKEY,
    });
  } else {
    console.log('[manychat-conversation] API Key found, length:', key.length);
  }
  
  return key;
}

/**
 * Знаходить subscriber в ManyChat за Instagram username
 */
async function findSubscriberByInstagram(instagram: string, apiKey: string): Promise<{ subscriberId: string | null; subscriber: any }> {
  const normalizedInstagram = normalizeInstagram(instagram);
  if (!normalizedInstagram) {
    return { subscriberId: null, subscriber: null };
  }

  try {
    // Метод 1: findByName
    const findByNameUrl = `https://api.manychat.com/fb/subscriber/findByName`;
    const findByNameResponse = await fetch(findByNameUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: normalizedInstagram,
      }),
    });

    if (findByNameResponse.ok) {
      const data = await findByNameResponse.json();
      const subscriberId = data?.data?.subscriber_id || data?.subscriber_id || data?.subscriber?.id;
      if (subscriberId) {
        return { subscriberId, subscriber: data };
      }
    }

    // Метод 2: getSubscribers з фільтрацією
    const maxPages = 5;
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
        
        for (const sub of subscribers) {
          const subInstagram = normalizeInstagram(sub.ig_username || sub.instagram_username || sub.username);
          if (subInstagram === normalizedInstagram) {
            return { subscriberId: sub.id, subscriber: sub };
          }
        }
      }
    }

    return { subscriberId: null, subscriber: null };
  } catch (error) {
    console.error('[manychat-conversation] Error finding subscriber:', error);
    return { subscriberId: null, subscriber: null };
  }
}

/**
 * Отримує історію повідомлень для subscriber через ManyChat API
 */
async function getConversationHistory(subscriberId: string, apiKey: string): Promise<any[]> {
  const results: any[] = [];
  
  try {
    // ManyChat API може мати різні методи для отримання історії
    // Спробуємо різні варіанти:
    
    // Варіант 1: getMessages (якщо існує)
    const messagesUrl = `https://api.manychat.com/fb/subscriber/getMessages?subscriber_id=${subscriberId}`;
    try {
      console.log('[manychat-conversation] Trying getMessages:', messagesUrl);
      const messagesResponse = await fetch(messagesUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const responseText = await messagesResponse.text();
      console.log('[manychat-conversation] getMessages response:', {
        status: messagesResponse.status,
        statusText: messagesResponse.statusText,
        responsePreview: responseText.substring(0, 500),
      });

      if (messagesResponse.ok) {
        try {
          const data = JSON.parse(responseText);
          if (data?.data && Array.isArray(data.data)) {
            console.log('[manychat-conversation] Found messages in data.data:', data.data.length);
            return data.data;
          }
          if (data?.messages && Array.isArray(data.messages)) {
            console.log('[manychat-conversation] Found messages in data.messages:', data.messages.length);
            return data.messages;
          }
          // Зберігаємо для діагностики
          results.push({ method: 'getMessages', response: data });
        } catch (parseErr) {
          console.log('[manychat-conversation] Failed to parse getMessages response');
        }
      } else {
        results.push({ 
          method: 'getMessages', 
          status: messagesResponse.status,
          error: responseText.substring(0, 200),
        });
      }
    } catch (err) {
      console.log('[manychat-conversation] getMessages method error:', err);
      results.push({ method: 'getMessages', error: err instanceof Error ? err.message : String(err) });
    }

    // Варіант 2: getConversation
    const conversationUrl = `https://api.manychat.com/fb/subscriber/getConversation?subscriber_id=${subscriberId}`;
    try {
      console.log('[manychat-conversation] Trying getConversation:', conversationUrl);
      const conversationResponse = await fetch(conversationUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const responseText = await conversationResponse.text();
      console.log('[manychat-conversation] getConversation response:', {
        status: conversationResponse.status,
        statusText: conversationResponse.statusText,
        responsePreview: responseText.substring(0, 500),
      });

      if (conversationResponse.ok) {
        try {
          const data = JSON.parse(responseText);
          if (data?.data && Array.isArray(data.data)) {
            console.log('[manychat-conversation] Found messages in data.data:', data.data.length);
            return data.data;
          }
          if (data?.messages && Array.isArray(data.messages)) {
            console.log('[manychat-conversation] Found messages in data.messages:', data.messages.length);
            return data.messages;
          }
          if (data?.conversation && Array.isArray(data.conversation)) {
            console.log('[manychat-conversation] Found messages in data.conversation:', data.conversation.length);
            return data.conversation;
          }
          results.push({ method: 'getConversation', response: data });
        } catch (parseErr) {
          console.log('[manychat-conversation] Failed to parse getConversation response');
        }
      } else {
        results.push({ 
          method: 'getConversation', 
          status: conversationResponse.status,
          error: responseText.substring(0, 200),
        });
      }
    } catch (err) {
      console.log('[manychat-conversation] getConversation method error:', err);
      results.push({ method: 'getConversation', error: err instanceof Error ? err.message : String(err) });
    }

    // Варіант 3: getSubscriberInfo (може містити останні повідомлення)
    const subscriberInfoUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subscriberId}`;
    try {
      console.log('[manychat-conversation] Trying getSubscriberInfo:', subscriberInfoUrl);
      const subscriberInfoResponse = await fetch(subscriberInfoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const responseText = await subscriberInfoResponse.text();
      console.log('[manychat-conversation] getSubscriberInfo response:', {
        status: subscriberInfoResponse.status,
        statusText: subscriberInfoResponse.statusText,
        responsePreview: responseText.substring(0, 500),
      });

      if (subscriberInfoResponse.ok) {
        try {
          const data = JSON.parse(responseText);
          // Перевіряємо, чи є повідомлення в відповіді
          if (data?.data?.messages && Array.isArray(data.data.messages)) {
            console.log('[manychat-conversation] Found messages in data.data.messages:', data.data.messages.length);
            return data.data.messages;
          }
          if (data?.messages && Array.isArray(data.messages)) {
            console.log('[manychat-conversation] Found messages in data.messages:', data.messages.length);
            return data.messages;
          }
          // Зберігаємо для діагностики
          results.push({ method: 'getSubscriberInfo', response: data });
        } catch (parseErr) {
          console.log('[manychat-conversation] Failed to parse getSubscriberInfo response');
        }
      } else {
        results.push({ 
          method: 'getSubscriberInfo', 
          status: subscriberInfoResponse.status,
          error: responseText.substring(0, 200),
        });
      }
    } catch (err) {
      console.log('[manychat-conversation] getSubscriberInfo method error:', err);
      results.push({ method: 'getSubscriberInfo', error: err instanceof Error ? err.message : String(err) });
    }

    console.log('[manychat-conversation] All methods tried, no messages found. Results:', results);
    return [];
  } catch (error) {
    console.error('[manychat-conversation] Error getting conversation history:', error);
    return [];
  }
}

/**
 * GET - отримати повну історію переписки з ManyChat API
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const instagramUsername = req.nextUrl.searchParams.get('instagramUsername');
    
    if (!instagramUsername) {
      return NextResponse.json(
        { ok: false, error: 'instagramUsername is required' },
        { status: 400 }
      );
    }

    const apiKey = getManyChatApiKey();
    if (!apiKey) {
      // Детальна діагностика доступних змінних
      const envCheck = {
        MANYCHAT_API_KEY: !!process.env.MANYCHAT_API_KEY,
        ManyChat_API_Key: !!process.env.ManyChat_API_Key,
        MANYCHAT_API_TOKEN: !!process.env.MANYCHAT_API_TOKEN,
        MC_API_KEY: !!process.env.MC_API_KEY,
        MANYCHAT_APIKEY: !!process.env.MANYCHAT_APIKEY,
        // Перевіряємо всі змінні, що містять "manychat" або "api"
        allEnvVars: Object.keys(process.env)
          .filter(key => /manychat|api.*key|mc.*key/i.test(key))
          .map(key => ({ key, hasValue: !!process.env[key], length: process.env[key]?.length || 0 })),
      };
      
      return NextResponse.json(
        { 
          ok: false, 
          error: 'ManyChat API Key not configured',
          hint: 'Set MANYCHAT_API_KEY or ManyChat_API_Key environment variable',
          diagnostics: envCheck,
        },
        { status: 500 }
      );
    }

    // Знаходимо subscriber
    const { subscriberId, subscriber } = await findSubscriberByInstagram(instagramUsername, apiKey);
    
    if (!subscriberId) {
      return NextResponse.json({
        ok: false,
        error: 'Subscriber not found in ManyChat',
        instagramUsername,
      });
    }

    // Отримуємо історію повідомлень
    const messages = await getConversationHistory(subscriberId, apiKey);

    // Діагностична інформація
    const diagnostics = {
      subscriberFound: !!subscriberId,
      subscriberId,
      messagesFound: messages.length,
      apiKeyConfigured: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
    };

    return NextResponse.json({
      ok: true,
      subscriberId,
      subscriber: {
        id: subscriber?.id,
        name: subscriber?.name,
        ig_username: subscriber?.ig_username,
      },
      messages: messages.map((msg: any) => ({
        id: msg.id || msg.message_id,
        text: msg.text || msg.content || msg.message,
        direction: msg.direction || (msg.from === 'user' ? 'incoming' : 'outgoing'),
        timestamp: msg.timestamp || msg.created_at || msg.date,
        type: msg.type || 'text',
      })),
      total: messages.length,
      diagnostics,
      note: messages.length === 0 
        ? 'ManyChat API may not support conversation history endpoint, or subscriber has no messages. Check diagnostics for details.'
        : undefined,
    });
  } catch (error) {
    console.error('[manychat-conversation] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
