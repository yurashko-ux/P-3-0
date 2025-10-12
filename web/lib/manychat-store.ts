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

export async function persistManychatSnapshot(
  message: ManychatStoredMessage,
  trace: ManychatWebhookTrace | null = null,
): Promise<void> {
  const payloadMessage = { ...message };
  const payloadTrace = trace ? { ...trace } : null;

  let stored = false;

  if (kvClient) {
    try {
      await kvClient.set(MANYCHAT_MESSAGE_KEY, payloadMessage);
      stored = true;
      if (payloadTrace) {
        await kvClient.set(MANYCHAT_TRACE_KEY, payloadTrace);
      }
    } catch {
      stored = false;
    }
  }

  if (!stored) {
    await kvWrite.setRaw(MANYCHAT_MESSAGE_KEY, JSON.stringify(payloadMessage));
    if (payloadTrace) {
      await kvWrite.setRaw(MANYCHAT_TRACE_KEY, JSON.stringify(payloadTrace));
    }
  }
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
