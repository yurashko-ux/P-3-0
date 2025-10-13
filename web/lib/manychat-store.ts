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

const FEED_LIMIT = 25;

function normaliseStoredMessage(input: ManychatStoredMessage): ManychatStoredMessage {
  const receivedAt =
    typeof input.receivedAt === 'number' && Number.isFinite(input.receivedAt)
      ? input.receivedAt
      : Date.now();

  const idValue =
    typeof input.id === 'number'
      ? input.id
      : typeof input.id === 'string' && input.id.trim().length
        ? input.id.trim()
        : receivedAt;

  const textValue =
    typeof input.text === 'string'
      ? input.text
      : input.text == null
        ? ''
        : String(input.text);

  return {
    ...input,
    id: idValue,
    receivedAt,
    source: input.source ?? 'manychat',
    title: input.title && input.title.trim().length ? input.title : 'ManyChat',
    handle: input.handle ?? null,
    fullName: input.fullName ?? null,
    text: textValue,
  };
}

function normaliseTrace(
  trace: ManychatWebhookTrace,
  fallback: ManychatStoredMessage,
): ManychatWebhookTrace {
  const receivedAt =
    typeof trace.receivedAt === 'number' && Number.isFinite(trace.receivedAt)
      ? trace.receivedAt
      : fallback.receivedAt;

  const status = trace.status === 'rejected' ? 'rejected' : 'accepted';
  const statusCode =
    typeof trace.statusCode === 'number' && Number.isFinite(trace.statusCode)
      ? trace.statusCode
      : status === 'rejected'
        ? 401
        : 200;

  const messagePreview =
    trace.messagePreview != null
      ? trace.messagePreview
      : fallback.text
          ? fallback.text.slice(0, 180)
          : null;

  return {
    ...trace,
    receivedAt,
    status,
    statusCode,
    handle: trace.handle ?? fallback.handle ?? null,
    fullName: trace.fullName ?? fallback.fullName ?? null,
    messagePreview,
  };
}

function dedupeMessages(messages: ManychatStoredMessage[]): ManychatStoredMessage[] {
  const seen = new Set<string>();
  const result: ManychatStoredMessage[] = [];

  for (const item of messages) {
    if (!item) continue;
    const normalised = normaliseStoredMessage(item);
    const key = `${typeof normalised.id === 'string' ? normalised.id : `#${normalised.id}`}` +
      `@${normalised.receivedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalised);
  }

  return result.slice(0, FEED_LIMIT);
}

async function writeFeedSnapshot(messages: ManychatStoredMessage[]): Promise<boolean> {
  const payload = dedupeMessages(messages);
  if (!payload.length) return false;

  let success = false;

  if (kvClient) {
    try {
      await kvClient.set(MANYCHAT_FEED_KEY, JSON.stringify(payload));
      success = true;
    } catch {
      // якщо неможливо записати через SDK — спробуємо REST нижче
    }
  }

  try {
    await kvWrite.setRaw(MANYCHAT_FEED_KEY, JSON.stringify(payload));
    success = true;
  } catch {
    if (!success) {
      throw new Error('Не вдалося зберегти журнал повідомлень у KV');
    }
  }

  return success;
}

export async function persistManychatSnapshot(
  message: ManychatStoredMessage,
  trace: ManychatWebhookTrace | null = null,
): Promise<void> {
  const payloadMessage = normaliseStoredMessage(message);
  const payloadTrace = trace ? normaliseTrace(trace, payloadMessage) : null;

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
    stored = true;
  }

  try {
    const { messages: existing } = await readManychatFeed(FEED_LIMIT - 1);
    const next = dedupeMessages([payloadMessage, ...existing]);
    await writeFeedSnapshot(next);
  } catch {
    // Ігноруємо помилки журналу: вони не мають блокувати вебхук.
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

export async function readManychatFeed(limit = 10): Promise<{
  messages: ManychatStoredMessage[];
  source: StoreSource | null;
  error?: string;
}> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));

  if (kvClient) {
    try {
      const rawList = await kvClient.lrange(MANYCHAT_FEED_KEY, 0, boundedLimit - 1);
      if (Array.isArray(rawList) && rawList.length) {
        const parsed = rawList
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

    try {
      const direct = (await kvClient.get(MANYCHAT_FEED_KEY)) as
        | ManychatStoredMessage[]
        | ManychatStoredMessage
        | string
        | null;
      if (direct) {
        const entries: ManychatStoredMessage[] = Array.isArray(direct)
          ? direct
          : typeof direct === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(direct) as ManychatStoredMessage[] | ManychatStoredMessage;
                  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
                } catch {
                  return [];
                }
              })()
            : [direct];
        const normalised = entries
          .map((entry) => (entry ? normaliseStoredMessage(entry) : null))
          .filter((entry): entry is ManychatStoredMessage => Boolean(entry));
        if (normalised.length) {
          return {
            messages: normalised.slice(0, boundedLimit),
            source: 'kv-client',
          };
        }
      }
    } catch {
      // якщо get не спрацював — спробуємо REST нижче
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

export async function ensureManychatFeedSnapshot(
  messages: ManychatStoredMessage[],
): Promise<boolean> {
  try {
    return await writeFeedSnapshot(messages);
  } catch {
    return false;
  }
}
