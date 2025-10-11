// web/lib/manychat-api.ts
// Легке SDK для ManyChat REST API з автоматичними fallback-ами парсингу.

export type ManychatLatestMessage = {
  id: string;
  conversationId: string | null;
  subscriberId: string | null;
  text: string;
  receivedAt: number | null;
  handle: string | null;
  fullName: string | null;
  source: string;
  raw: Record<string, unknown>;
};

type RequestOptions = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  query?: Record<string, string | number | null | undefined>;
  body?: any;
  signal?: AbortSignal;
};

const API_BASE = (process.env.MANYCHAT_API_BASE || 'https://api.manychat.com').replace(/\/$/, '');
const API_KEY = process.env.MANYCHAT_API_KEY || process.env.MANYCHAT_API_TOKEN || process.env.MC_API_KEY || '';

function pickString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function pickNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const num = Number(value.trim());
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\/+/, ''), `${API_BASE}/`);
  if (query) {
    for (const [key, val] of Object.entries(query)) {
      if (val === undefined || val === null || val === '') continue;
      url.searchParams.set(key, String(val));
    }
  }
  return url.toString();
}

async function manychatRequest<T = any>({ path, method = 'GET', query, body, signal }: RequestOptions): Promise<{ json: T | null; text: string; status: number; ok: boolean; url: string; }> {
  if (!API_KEY) {
    const err = new Error('MANYCHAT_API_KEY is not configured');
    (err as any).code = 'manychat_api_key_missing';
    throw err;
  }

  const url = buildUrl(path, query);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal,
  });

  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const error = new Error(`ManyChat ${res.status}`);
    (error as any).status = res.status;
    (error as any).response = json ?? text;
    (error as any).url = url;
    throw error;
  }

  return { json: (json as T) ?? null, text, status: res.status, ok: res.ok, url };
}

function extractSubscriber(obj: any): { handle: string | null; fullName: string | null; id: string | null } {
  if (!obj || typeof obj !== 'object') {
    return { handle: null, fullName: null, id: null };
  }
  const handle =
    pickString(
      obj.username,
      obj.instagram_username,
      obj.instagramUsername,
      obj.user_name,
      obj.userName,
      obj.handle,
      obj.name && obj.name.startsWith('@') ? obj.name.slice(1) : null,
      obj.contact?.username,
      obj.contact?.instagram_username,
      obj.contact?.handle,
      obj.subscriber?.username,
      obj.subscriber?.instagram_username,
    ) || null;

  const fullName = pickString(
    obj.full_name,
    obj.fullName,
    obj.name,
    obj.contact?.full_name,
    obj.contact?.fullName,
    obj.contact?.name,
    obj.subscriber?.full_name,
    obj.subscriber?.name,
  );

  const id = pickString(
    obj.id,
    obj.subscriber_id,
    obj.subscriberId,
    obj.contact?.id,
    obj.subscriber?.id,
  );

  return { handle, fullName, id };
}

function normalizeMessage(input: any, conversation?: any): ManychatLatestMessage | null {
  if (!input && !conversation) return null;

  const message = input && typeof input === 'object' ? input : conversation;
  const conversationId =
    pickString(
      conversation?.conversation_id,
      conversation?.conversationId,
      conversation?.id,
      conversation?.subscriber_id,
      conversation?.subscriberId,
      message?.conversation_id,
      message?.conversationId,
      message?.chat_id,
      message?.chatId,
    ) || null;

  const subscriber = extractSubscriber(conversation?.subscriber || conversation?.contact || message?.subscriber || message?.contact || conversation || {});

  const text =
    pickString(
      message?.text,
      message?.message,
      message?.content,
      message?.content?.text,
      message?.last_message_text,
      message?.lastMessageText,
      conversation?.last_message_text,
      conversation?.lastMessageText,
      conversation?.last_message?.text,
      conversation?.lastMessage?.text,
    ) || '';

  const receivedAt =
    pickNumber(
      message?.created_at,
      message?.createdAt,
      message?.timestamp,
      message?.ts,
      message?.sent_at,
      message?.sentAt,
      conversation?.last_message_at,
      conversation?.lastMessageAt,
      conversation?.last_interaction_at,
      conversation?.lastInteractionAt,
      Date.now(),
    );

  const id =
    pickString(
      message?.id,
      message?.message_id,
      message?.messageId,
      message?.event_id,
      message?.eventId,
      message?.message?.id,
    ) || (receivedAt ? String(receivedAt) : `${Date.now()}`);

  return {
    id,
    conversationId,
    subscriberId: subscriber.id,
    text,
    receivedAt,
    handle: subscriber.handle,
    fullName: subscriber.fullName,
    source: 'manychat:api',
    raw: { conversation, message },
  };
}

async function loadConversationMessages(conversationId: string): Promise<ManychatLatestMessage | null> {
  const candidates: Array<{ path: string; query?: Record<string, string> }> = [
    { path: `/instagram/conversations/${conversationId}/messages`, query: { limit: '1', order: 'desc' } },
    { path: `/instagram/conversations/${conversationId}/messages`, query: { limit: '1' } },
    { path: `/conversations/${conversationId}/messages`, query: { limit: '1', order: 'desc' } },
  ];

  for (const attempt of candidates) {
    try {
      const { json } = await manychatRequest<any>({ path: attempt.path, query: attempt.query });
      const arr =
        (Array.isArray(json?.data?.messages) ? json?.data?.messages : undefined) ??
        (Array.isArray(json?.messages) ? json?.messages : undefined) ??
        (Array.isArray(json?.data) ? json?.data : undefined) ?? [];
      const first = arr[0];
      const normalized = normalizeMessage(first, json?.data?.conversation ?? json?.conversation ?? {});
      if (normalized) return normalized;
    } catch (err) {
      // ignore and try next attempt
      continue;
    }
  }

  return null;
}

export async function fetchManychatLatest(limit = 5): Promise<{ messages: ManychatLatestMessage[]; meta: { source: 'api'; url: string } }> {
  const { json, url } = await manychatRequest<any>({
    path: '/instagram/conversations',
    query: { limit: String(Math.max(1, Math.min(limit, 20))) },
  });

  const collection: any[] =
    (Array.isArray(json?.data?.conversations) ? json?.data?.conversations : undefined) ??
    (Array.isArray(json?.data) ? json?.data : undefined) ??
    (Array.isArray(json?.conversations) ? json?.conversations : undefined) ??
    (Array.isArray(json?.result) ? json?.result : undefined) ?? [];

  const normalized: ManychatLatestMessage[] = [];

  for (const conversation of collection) {
    let candidate: ManychatLatestMessage | null = null;
    if (conversation?.last_message || conversation?.lastMessage) {
      candidate = normalizeMessage(conversation?.last_message ?? conversation?.lastMessage, conversation);
    }
    if (!candidate) {
      candidate = normalizeMessage(conversation, conversation);
    }
    if ((!candidate || !candidate.text) && candidate?.conversationId) {
      const fallback = await loadConversationMessages(candidate.conversationId);
      if (fallback) {
        candidate = { ...fallback, raw: { ...fallback.raw, conversation } };
      }
    }
    if (candidate) {
      normalized.push(candidate);
    }
  }

  normalized.sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0));

  return { messages: normalized.slice(0, limit), meta: { source: 'api', url } };
}
