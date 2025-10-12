// web/lib/manychat-store.ts
// Спільне сховище для останнього ManyChat-повідомлення й трасування вебхука.

import { kvWrite, kvRead } from '@/lib/kv';

type KvClient = typeof import('@vercel/kv').kv;

let kvClient: KvClient | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@vercel/kv') as { kv?: KvClient };
  if (mod?.kv) {
    kvClient = mod.kv;
  }
} catch {
  // Якщо клієнт недоступний, використовуємо REST-фоли
  kvClient = null;
}

export type ManychatStoredMessage = {
  id: number | string;
  receivedAt: number;
  source: string;
  title: string;
  handle: string | null;
  fullName: string | null;
  text: string;
  raw: unknown;
};

export type ManychatWebhookTrace = {
  receivedAt: number;
  status: 'accepted' | 'rejected';
  reason?: string | null;
  statusCode?: number | null;
  handle?: string | null;
  fullName?: string | null;
  messagePreview?: string | null;
};

export const MANYCHAT_MESSAGE_KEY = 'manychat:last-message';
export const MANYCHAT_TRACE_KEY = 'manychat:last-trace';
export const MANYCHAT_FEED_KEY = 'manychat:last-feed';

export type ManychatPersistResult = {
  messageStored: boolean;
  traceStored: boolean;
  feedStored: boolean;
  via: 'kv-client' | 'kv-rest' | null;
  errors: string[];
};

export async function persistManychatSnapshot(
  message: ManychatStoredMessage,
  trace: ManychatWebhookTrace | null = null,
): Promise<ManychatPersistResult> {
  const payloadMessage = { ...message };
  const payloadTrace = trace ? { ...trace } : null;
  const feedLimit = 25;

  let messageStored = false;
  let traceStored = false;
  let feedStored = false;
  let via: ManychatPersistResult['via'] = null;
  const errors: string[] = [];

  if (kvClient) {
    try {
      await kvClient.set(MANYCHAT_MESSAGE_KEY, payloadMessage);
      messageStored = true;
      via = 'kv-client';
      if (payloadTrace) {
        await kvClient.set(MANYCHAT_TRACE_KEY, payloadTrace);
        traceStored = true;
      }
      try {
        await kvClient.lpush(MANYCHAT_FEED_KEY, JSON.stringify(payloadMessage));
        await kvClient.ltrim(MANYCHAT_FEED_KEY, 0, feedLimit - 1);
        feedStored = true;
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `kvClient.lpush/ltrim: ${error.message}`
            : 'kvClient.lpush/ltrim: unknown error',
        );
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? `kvClient.set: ${error.message}` : 'kvClient.set: unknown error',
      );
      messageStored = false;
      traceStored = false;
      feedStored = false;
    }
  }

  if (!messageStored) {
    try {
      await kvWrite.setRaw(MANYCHAT_MESSAGE_KEY, JSON.stringify(payloadMessage));
      messageStored = true;
      via = 'kv-rest';
    } catch (error) {
      errors.push(
        error instanceof Error ? `kvWrite.setRaw(message): ${error.message}` : 'kvWrite.setRaw(message)',
      );
    }
  }

  if (payloadTrace && !traceStored) {
    try {
      await kvWrite.setRaw(MANYCHAT_TRACE_KEY, JSON.stringify(payloadTrace));
      traceStored = true;
      if (!via) via = 'kv-rest';
    } catch (error) {
      errors.push(
        error instanceof Error ? `kvWrite.setRaw(trace): ${error.message}` : 'kvWrite.setRaw(trace)',
      );
    }
  }

  if (!feedStored) {
    try {
      await kvWrite.lpush(MANYCHAT_FEED_KEY, JSON.stringify(payloadMessage));
      await kvWrite.ltrim(MANYCHAT_FEED_KEY, 0, feedLimit - 1);
      feedStored = true;
      if (!via) via = 'kv-rest';
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `kvWrite.lpush/ltrim: ${error.message}`
          : 'kvWrite.lpush/ltrim: unknown error',
      );
    }
  }

  try {
    const existingRaw = await kvRead.getRaw(MANYCHAT_FEED_KEY);
    let existing: ManychatStoredMessage[] = [];
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw) as ManychatStoredMessage[];
        if (Array.isArray(parsed)) {
          existing = parsed.filter((item): item is ManychatStoredMessage => Boolean(item));
        }
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `kvRead.getRaw(feed) parse: ${error.message}`
            : 'kvRead.getRaw(feed) parse',
        );
        existing = [];
      }
    }

    const next = [payloadMessage, ...existing]
      .slice(0, feedLimit)
      .map((item) => ({
        ...item,
        receivedAt: typeof item.receivedAt === 'number' ? item.receivedAt : Date.now(),
      }));

    await kvWrite.setRaw(MANYCHAT_FEED_KEY, JSON.stringify(next));
    feedStored = true;
    if (!via) via = 'kv-rest';
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `kvWrite.setRaw(feed): ${error.message}`
        : 'kvWrite.setRaw(feed): unknown error',
    );
  }

  return { messageStored, traceStored, feedStored, via, errors };
}

type StoreSource = 'kv-client' | 'kv-rest';

async function readFromKvClient<T>(key: string): Promise<T | null> {
  if (!kvClient) return null;
  try {
    const value = (await kvClient.get(key)) as T | string | null;
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

export async function readManychatMessage(): Promise<{
  message: ManychatStoredMessage | null;
  source: StoreSource | null;
  error?: string;
}> {
  const direct = await readFromKvClient<ManychatStoredMessage>(MANYCHAT_MESSAGE_KEY);
  if (direct) {
    return { message: direct, source: 'kv-client' };
  }

  const raw = await kvRead.getRaw(MANYCHAT_MESSAGE_KEY);
  if (!raw) return { message: null, source: null };
  try {
    const parsed = JSON.parse(raw) as ManychatStoredMessage;
    if (parsed && typeof parsed === 'object') {
      const receivedAt = typeof parsed.receivedAt === 'number' ? parsed.receivedAt : Date.now();
      return { message: { ...parsed, receivedAt }, source: 'kv-rest' };
    }
  } catch (error) {
    return {
      message: null,
      source: 'kv-rest',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { message: null, source: 'kv-rest' };
}

export async function readManychatTrace(): Promise<{
  trace: ManychatWebhookTrace | null;
  source: StoreSource | null;
  error?: string;
}> {
  const direct = await readFromKvClient<ManychatWebhookTrace>(MANYCHAT_TRACE_KEY);
  if (direct) {
    return { trace: direct, source: 'kv-client' };
  }

  const raw = await kvRead.getRaw(MANYCHAT_TRACE_KEY);
  if (!raw) return { trace: null, source: null };
  try {
    const parsed = JSON.parse(raw) as ManychatWebhookTrace;
    if (parsed && typeof parsed === 'object') {
      return { trace: parsed, source: 'kv-rest' };
    }
  } catch (error) {
    return {
      trace: null,
      source: 'kv-rest',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { trace: null, source: 'kv-rest' };
}

export async function readManychatFeed(limit = 10): Promise<{
  messages: ManychatStoredMessage[];
  source: StoreSource | null;
  error?: string;
}> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));

  if (kvClient) {
    try {
      const raw = await kvClient.lrange(MANYCHAT_FEED_KEY, 0, boundedLimit - 1);
      if (Array.isArray(raw) && raw.length) {
        const parsed = raw
          .map((entry) => {
            if (typeof entry === 'string') {
              try {
                return JSON.parse(entry) as ManychatStoredMessage;
              } catch {
                return null;
              }
            }
            return (entry ?? null) as ManychatStoredMessage | null;
          })
          .filter((item): item is ManychatStoredMessage => Boolean(item));
        if (parsed.length) {
          return {
            messages: parsed.slice(0, boundedLimit),
            source: 'kv-client',
          };
        }
      }
    } catch {
      // ігноруємо, переходимо до REST
    }
  }

  const rawList = await kvRead.lrange(MANYCHAT_FEED_KEY, 0, boundedLimit - 1);
  if (rawList && rawList.length > 0) {
    const messages: ManychatStoredMessage[] = [];
    for (const entry of rawList) {
      try {
        const parsed = JSON.parse(entry) as ManychatStoredMessage;
        if (parsed && typeof parsed === 'object') {
          messages.push({
            ...parsed,
            receivedAt: typeof parsed.receivedAt === 'number' ? parsed.receivedAt : Date.now(),
          });
        }
      } catch (error) {
        return {
          messages,
          source: 'kv-rest',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (messages.length > 0) {
      return { messages: messages.slice(0, boundedLimit), source: 'kv-rest' };
    }
  }

  const raw = await kvRead.getRaw(MANYCHAT_FEED_KEY);
  if (!raw) {
    return { messages: [], source: null };
  }

  try {
    const parsed = JSON.parse(raw) as ManychatStoredMessage[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        messages: parsed
          .slice(0, boundedLimit)
          .map((item) => ({
            ...item,
            receivedAt: typeof item.receivedAt === 'number' ? item.receivedAt : Date.now(),
          })),
        source: 'kv-rest',
      };
    }
  } catch (error) {
    return {
      messages: [],
      source: 'kv-rest',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return { messages: [], source: 'kv-rest' };
}
