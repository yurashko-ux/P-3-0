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
  return (
    process.env.MANYCHAT_API_KEY || 
    process.env.ManyChat_API_Key ||
    process.env.MANYCHAT_API_TOKEN || 
    process.env.MC_API_KEY ||
    process.env.MANYCHAT_APIKEY ||
    null
  );
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
  try {
    // ManyChat API може мати різні методи для отримання історії
    // Спробуємо різні варіанти:
    
    // Варіант 1: getMessages (якщо існує)
    const messagesUrl = `https://api.manychat.com/fb/subscriber/getMessages?subscriber_id=${subscriberId}`;
    try {
      const messagesResponse = await fetch(messagesUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (messagesResponse.ok) {
        const data = await messagesResponse.json();
        if (data?.data && Array.isArray(data.data)) {
          return data.data;
        }
        if (data?.messages && Array.isArray(data.messages)) {
          return data.messages;
        }
      }
    } catch (err) {
      console.log('[manychat-conversation] getMessages method not available or failed');
    }

    // Варіант 2: getConversation
    const conversationUrl = `https://api.manychat.com/fb/subscriber/getConversation?subscriber_id=${subscriberId}`;
    try {
      const conversationResponse = await fetch(conversationUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (conversationResponse.ok) {
        const data = await conversationResponse.json();
        if (data?.data && Array.isArray(data.data)) {
          return data.data;
        }
        if (data?.messages && Array.isArray(data.messages)) {
          return data.messages;
        }
        if (data?.conversation && Array.isArray(data.conversation)) {
          return data.conversation;
        }
      }
    } catch (err) {
      console.log('[manychat-conversation] getConversation method not available or failed');
    }

    // Варіант 3: getSubscriberInfo (може містити останні повідомлення)
    const subscriberInfoUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subscriberId}`;
    try {
      const subscriberInfoResponse = await fetch(subscriberInfoUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (subscriberInfoResponse.ok) {
        const data = await subscriberInfoResponse.json();
        // Перевіряємо, чи є повідомлення в відповіді
        if (data?.data?.messages && Array.isArray(data.data.messages)) {
          return data.data.messages;
        }
        if (data?.messages && Array.isArray(data.messages)) {
          return data.messages;
        }
      }
    } catch (err) {
      console.log('[manychat-conversation] getSubscriberInfo method not available or failed');
    }

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
      return NextResponse.json(
        { 
          ok: false, 
          error: 'ManyChat API Key not configured',
          hint: 'Set MANYCHAT_API_KEY environment variable',
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
      note: messages.length === 0 
        ? 'ManyChat API may not support conversation history endpoint, or subscriber has no messages'
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
