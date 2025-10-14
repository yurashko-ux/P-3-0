// web/app/api/mc/manychat/route.ts
// Спрощений ManyChat webhook: лише фіксує останнє повідомлення в пам'яті
// й повертає його для тестової адмін-сторінки.

import { NextRequest, NextResponse } from 'next/server';
import { getEnvValue, hasEnvValue } from '@/lib/env';
import { getKvConfigStatus } from '@/lib/kv';
import {
  MANYCHAT_MESSAGE_KEY,
  MANYCHAT_TRACE_KEY,
  MANYCHAT_FEED_KEY,
  MANYCHAT_RAW_KEY,
  persistManychatSnapshot,
  readManychatMessage,
  readManychatTrace,
  readManychatFeed,
  ensureManychatFeedSnapshot,
  readManychatRaw,
  type ManychatStoredMessage,
  type ManychatWebhookTrace,
} from '@/lib/manychat-store';

type LatestMessage = ManychatStoredMessage;
type WebhookTrace = ManychatWebhookTrace;

type Diagnostics = {
  api?: {
    ok: boolean;
    message?: string;
    note?: string;
  } | null;
  kvConfig?: {
    hasBaseUrl: boolean;
    hasReadToken: boolean;
    hasWriteToken: boolean;
    candidates: number;
  } | null;
  kv?: {
    ok: boolean;
    key: string;
    source: 'memory' | 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvTrace?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvRaw?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    message?: string;
  } | null;
  kvFeed?: {
    ok: boolean;
    key: string;
    source: 'kv' | 'miss' | 'error';
    count?: number;
    message?: string;
  } | null;
  traceFallback?: {
    used: boolean;
    reason: string;
  } | null;
};

let lastMessage: LatestMessage | null = null;
let lastTrace: WebhookTrace | null = null;
let sequence = 0;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toTrimmedString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function pickFirstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    const str = toTrimmedString(value);
    if (str) return str;
  }
  return null;
}

function safeSerialise(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function recoverTextFromRaw(
  raw: unknown,
  visited: WeakSet<Record<string, unknown>> = new WeakSet(),
): string | null {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const result = recoverTextFromRaw(item, visited);
      if (result) return result;
    }
    return null;
  }

  if (typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (visited.has(record)) return null;
  visited.add(record);

  const direct = pickFirstString(
    record.text,
    record.message,
    record.content,
    record.body,
    record.payload,
    record.preview,
    record.description,
  );
  if (direct) return direct;

  for (const value of Object.values(record)) {
    const nested = recoverTextFromRaw(value, visited);
    if (nested) return nested;
  }

  return null;
}

function normalisePayload(payload: unknown, rawText?: string | null): LatestMessage {
  const body = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};

  const handle = pickFirstString(
    body.handle,
    body.username,
    (body.subscriber as Record<string, unknown> | undefined)?.username,
    (body.user as Record<string, unknown> | undefined)?.username,
    (body.sender as Record<string, unknown> | undefined)?.username,
  );

  const fullName = pickFirstString(
    body.full_name,
    body.fullName,
    body.fullname,
    body.name,
    [body.first_name, body.last_name].filter(Boolean).join(' ').trim() || null,
    (body.subscriber as Record<string, unknown> | undefined)?.name,
    (body.user as Record<string, unknown> | undefined)?.full_name,
    (body.sender as Record<string, unknown> | undefined)?.name,
  );

  const nestedMessage = body.message as Record<string, unknown> | undefined;
  const nestedData = body.data as Record<string, unknown> | undefined;

  const text =
    pickFirstString(
      body.text,
      nestedMessage?.text,
      nestedData?.text,
      nestedMessage,
      nestedData,
    ) ?? '';

  const title = pickFirstString(
    body.title,
    nestedMessage?.title,
    nestedData?.title,
  ) ?? 'IG Message';

  return {
    id: ++sequence,
    receivedAt: Date.now(),
    source: 'webhook:/api/mc/manychat',
    title,
    handle,
    fullName,
    text,
    raw: payload,
    rawText: rawText ?? safeSerialise(payload),
  };
}

async function readRequestPayload(req: NextRequest): Promise<{ parsed: unknown; rawText: string | null }> {
  let bodyText: string | null = null;

  try {
    bodyText = await req.text();
  } catch {
    bodyText = null;
  }

  if (!bodyText) {
    return { parsed: {}, rawText: null };
  }

  const trimmed = bodyText.trim();
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';

  // Спробуємо спочатку розпарсити як JSON — ManyChat зазвичай шле саме такий формат.
  if (trimmed) {
    try {
      return { parsed: JSON.parse(trimmed) as unknown, rawText: bodyText };
    } catch {
      // ігноруємо, переходимо до альтернативних варіантів
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(bodyText);
      const record: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        record[key] = value;
      }
      return { parsed: record, rawText: bodyText };
    } catch {
      // якщо не вдалося — впадемо до текстового варіанта нижче
    }
  }

  return { parsed: { text: bodyText, raw: bodyText }, rawText: bodyText };
}

export async function POST(req: NextRequest) {
  const mcToken = getEnvValue('MC_TOKEN');
  const apiToken = getEnvValue('MANYCHAT_API_KEY', 'MANYCHAT_API_TOKEN', 'MC_API_KEY');
  const headerToken =
    req.headers.get('x-mc-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

  const allowedTokens = new Set<string>();
  if (mcToken) allowedTokens.add(mcToken);
  if (apiToken) allowedTokens.add(apiToken);

  if (allowedTokens.size > 0 && headerToken) {
    if (!allowedTokens.has(headerToken)) {
      lastTrace = {
        receivedAt: Date.now(),
        status: 'rejected',
        reason: 'Невірний токен авторизації',
        statusCode: 401,
      };
      return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401 });
    }
  }

  const { parsed: payload, rawText } = await readRequestPayload(req);

  const message = normalisePayload(payload, rawText);
  lastMessage = message;
  lastTrace = {
    receivedAt: message.receivedAt,
    status: 'accepted',
    statusCode: 200,
    handle: message.handle,
    fullName: message.fullName,
    messagePreview: message.text ? message.text.slice(0, 180) : null,
  };

  try {
    await persistManychatSnapshot(message, lastTrace);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : typeof error === 'string' ? error : null;
    lastTrace = {
      ...lastTrace,
      reason: reason
        ? `Помилка збереження у KV: ${reason}`
        : 'Помилка збереження у KV',
    };
  }

  return NextResponse.json({ ok: true, message });
}

export async function GET() {
  const diagnostics: Diagnostics = {};
  const apiKeyAvailable = hasEnvValue(
    'MANYCHAT_API_KEY',
    'MANYCHAT_API_TOKEN',
    'MC_API_KEY',
  );

  const kvStatus = getKvConfigStatus();
  diagnostics.kvConfig = {
    hasBaseUrl: kvStatus.hasBaseUrl,
    hasReadToken: kvStatus.hasReadToken,
    hasWriteToken: kvStatus.hasWriteToken,
    candidates: kvStatus.baseCandidates.length,
  };

  let source: 'memory' | 'kv' | 'api' | 'trace' | null = lastMessage ? 'memory' : null;
  let latest = lastMessage;
  let trace = lastTrace;

  if (latest) {
    diagnostics.kv = { ok: true, key: MANYCHAT_MESSAGE_KEY, source: 'memory' };
  } else {
    const { message: stored, source: storedSource, error: storeError } = await readManychatMessage();
    if (stored) {
      latest = stored;
      source = 'kv';
      diagnostics.kv = {
        ok: true,
        key: MANYCHAT_MESSAGE_KEY,
        source: storedSource === 'kv-rest' ? 'kv' : 'kv',
      };
    } else if (storeError) {
      diagnostics.kv = {
        ok: false,
        key: MANYCHAT_MESSAGE_KEY,
        source: 'error',
        message: storeError,
      };
    } else {
      diagnostics.kv = {
        ok: false,
        key: MANYCHAT_MESSAGE_KEY,
        source: 'miss',
        message: 'KV не містить збереженого повідомлення',
      };
    }
  }

  if (!trace) {
    const { trace: storedTrace, error: traceError, source: traceSource } = await readManychatTrace();
    if (storedTrace) {
      trace = storedTrace;
      diagnostics.kvTrace = {
        ok: true,
        key: MANYCHAT_TRACE_KEY,
        source: traceSource === 'kv-rest' ? 'kv' : 'kv',
      };
    } else if (traceError) {
      diagnostics.kvTrace = {
        ok: false,
        key: MANYCHAT_TRACE_KEY,
        source: 'error',
        message: traceError,
      };
    } else {
      diagnostics.kvTrace = {
        ok: false,
        key: MANYCHAT_TRACE_KEY,
        source: 'miss',
        message: 'KV не містить трасування вебхука',
      };
    }
  }

  const rawResult = await readManychatRaw();
  if (rawResult.raw !== undefined && rawResult.raw !== null) {
    diagnostics.kvRaw = {
      ok: true,
      key: MANYCHAT_RAW_KEY,
      source: 'kv',
    };
  } else if (rawResult.error) {
    diagnostics.kvRaw = {
      ok: false,
      key: MANYCHAT_RAW_KEY,
      source: 'error',
      message: rawResult.error,
    };
  } else {
    diagnostics.kvRaw = {
      ok: false,
      key: MANYCHAT_RAW_KEY,
      source: 'miss',
      message: 'KV не містить сирого payload останнього вебхука',
    };
  }

  let feed: LatestMessage[] = latest ? [latest] : [];

  const feedResultInitial = await readManychatFeed(10);
  let storedFeed = feedResultInitial.messages;
  let feedSource = feedResultInitial.source;
  let feedError = feedResultInitial.error;
  let feedRestored = false;

  if (!storedFeed.length && latest) {
    const restored = await ensureManychatFeedSnapshot([latest]);
    if (restored) {
      const retry = await readManychatFeed(10);
      if (retry.messages.length) {
        storedFeed = retry.messages;
        feedSource = retry.source;
        feedError = retry.error;
        feedRestored = true;
      }
    }
  }

  if (storedFeed.length) {
    feed = storedFeed;
    latest = latest ?? storedFeed[0];
    source = source ?? 'kv';
    diagnostics.kvFeed = {
      ok: true,
      key: MANYCHAT_FEED_KEY,
      source: 'kv',
      count: storedFeed.length,
      message:
        feedRestored
          ? 'Журнал відновлено на основі останнього вебхука'
          : feedSource === 'kv-client'
            ? 'Журнал отримано через @vercel/kv'
            : feedSource === 'kv-rest'
              ? 'Журнал отримано через REST API Vercel KV'
              : undefined,
    };
  } else if (feedError) {
    diagnostics.kvFeed = {
      ok: false,
      key: MANYCHAT_FEED_KEY,
      source: 'error',
      message: feedError,
    };
  } else {
    diagnostics.kvFeed = {
      ok: false,
      key: MANYCHAT_FEED_KEY,
      source: 'miss',
      message: 'Журнал повідомлень у KV порожній',
    };
  }

  diagnostics.api = {
    ok: false,
    message: apiKeyAvailable
      ? 'ManyChat API вимкнено: використовуються лише дані з вебхука.'
      : 'ManyChat API вимкнено і ключ не використовується.',
    note: 'API-запити до ManyChat не виконуються за вимогою.',
  };

  if (feed.length === 0 && trace) {
    const fallbackText = trace.messagePreview ?? '';
    const fallbackHandle = trace.handle ?? null;
    const fallbackFullName = trace.fullName ?? null;

    if (fallbackText || fallbackHandle || fallbackFullName) {
      const fallbackMessage: LatestMessage = {
        id: trace.receivedAt,
        receivedAt: trace.receivedAt,
        source: 'trace:webhook',
        title: 'ManyChat Webhook (trace)',
        handle: fallbackHandle,
        fullName: fallbackFullName,
        text: fallbackText,
        raw: null,
        rawText: null,
      };

      feed = [fallbackMessage];
      latest = fallbackMessage;
      source = source ?? 'trace';
      diagnostics.traceFallback = {
        used: true,
        reason: 'Відображаємо останній вебхук із трасування, оскільки повідомлення не знайдено у KV або ManyChat API.',
      };
    }
  }

  if (latest && feed.length === 0) {
    feed = [latest];
  }

  const rehydrateRaw = (message: LatestMessage): LatestMessage => {
    if (!message) return message;
    const enriched: LatestMessage = { ...message };
    if (enriched.raw == null && rawResult.raw !== undefined && rawResult.raw !== null) {
      enriched.raw = rawResult.raw;
    }
    if ((enriched as any).rawText == null && rawResult.text != null) {
      (enriched as any).rawText = rawResult.text;
    }
    if (!enriched.text || !enriched.text.trim().length) {
      const fromRaw = recoverTextFromRaw(enriched.raw ?? rawResult.raw);
      if (fromRaw && fromRaw.trim().length) {
        enriched.text = fromRaw.trim();
      } else if (typeof rawResult.text === 'string' && rawResult.text.trim().length) {
        const candidate = rawResult.text.trim();
        if (candidate.startsWith('{') || candidate.startsWith('[')) {
          try {
            const parsed = JSON.parse(candidate) as unknown;
            const parsedText = recoverTextFromRaw(parsed);
            if (parsedText && parsedText.trim().length) {
              enriched.text = parsedText.trim();
            } else {
              enriched.text = candidate;
            }
          } catch {
            enriched.text = candidate;
          }
        } else {
          enriched.text = candidate;
        }
      }
    }
    return enriched;
  };

  if (latest) {
    latest = rehydrateRaw(latest);
  }

  if (feed.length) {
    feed = feed.map(rehydrateRaw);
  }

  if (!source && feed.length > 0) {
    source = 'kv';
  }

  if (trace || latest) {
    const candidateMessage = latest ?? feed[0] ?? null;
    if (trace) {
      const numericReceived =
        typeof trace.receivedAt === 'number' && Number.isFinite(trace.receivedAt)
          ? trace.receivedAt
          : typeof trace.receivedAt === 'string'
            ? Number(trace.receivedAt)
            : NaN;
      trace = {
        ...trace,
        receivedAt: Number.isFinite(numericReceived)
          ? numericReceived
          : candidateMessage && typeof candidateMessage.receivedAt === 'number'
            ? candidateMessage.receivedAt
            : Date.now(),
        status: trace.status === 'rejected' || trace.status === 'accepted' ? trace.status : 'accepted',
        statusCode:
          typeof trace.statusCode === 'number' && Number.isFinite(trace.statusCode)
            ? trace.statusCode
            : trace.status === 'rejected'
              ? 401
              : 200,
        handle: trace.handle ?? candidateMessage?.handle ?? null,
        fullName: trace.fullName ?? candidateMessage?.fullName ?? null,
        messagePreview:
          trace.messagePreview ?? candidateMessage?.text?.slice(0, 180) ?? null,
      };
    } else if (candidateMessage) {
      trace = {
        receivedAt:
          typeof candidateMessage.receivedAt === 'number' && Number.isFinite(candidateMessage.receivedAt)
            ? candidateMessage.receivedAt
            : Date.now(),
        status: 'accepted',
        statusCode: 200,
        handle: candidateMessage.handle ?? null,
        fullName: candidateMessage.fullName ?? null,
        messagePreview: candidateMessage.text ? candidateMessage.text.slice(0, 180) : null,
      };
    }
  }

  return NextResponse.json({
    ok: true,
    latest: latest ?? null,
    feed,
    messages: feed,
    source,
    trace,
    diagnostics,
  });
}
