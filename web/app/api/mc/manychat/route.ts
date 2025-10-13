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
  persistManychatSnapshot,
  readManychatMessage,
  readManychatTrace,
  readManychatFeed,
  ensureManychatFeedSnapshot,
  type ManychatStoredMessage,
  type ManychatWebhookTrace,
} from '@/lib/manychat-store';
import { fetchManychatLatest, type ManychatLatestMessage } from '@/lib/manychat-api';

type LatestMessage = ManychatStoredMessage;
type WebhookTrace = ManychatWebhookTrace;

type Diagnostics = {
  api?: {
    ok: boolean;
    message?: string;
    url?: string;
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

function ensureMessageText(
  message: LatestMessage,
  fallbackTrace: WebhookTrace | null = null,
): LatestMessage {
  const raw = message.raw && typeof message.raw === 'object' ? (message.raw as Record<string, unknown>) : null;
  const nestedMessage = raw && typeof raw.message === 'object' ? (raw.message as Record<string, unknown>) : null;
  const nestedData = raw && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;

  const candidate =
    pickFirstString(
      message.text,
      nestedMessage?.text,
      nestedData?.text,
      nestedMessage,
      nestedData,
      raw?.text,
      raw?.message,
      raw?.content && typeof raw.content === 'object'
        ? (raw.content as Record<string, unknown>)?.text
        : undefined,
      fallbackTrace?.messagePreview,
    ) ?? '';

  if (candidate === message.text || (candidate === '' && message.text === '')) {
    return message;
  }

  return {
    ...message,
    text: candidate,
  };
}

function normalisePayload(payload: unknown): LatestMessage {
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

  return ensureMessageText({
    id: ++sequence,
    receivedAt: Date.now(),
    source: 'webhook:/api/mc/manychat',
    title,
    handle,
    fullName,
    text,
    raw: payload,
  });
}

function fromManychatApi(message: ManychatLatestMessage, fallback: number): LatestMessage {
  const id = message.id && message.id !== '' ? message.id : `manychat-${fallback}`;
  const rawConversation = (message.raw as Record<string, unknown> | undefined)?.conversation as
    | Record<string, unknown>
    | undefined;
  const titleCandidate = rawConversation?.title;
  const title =
    typeof titleCandidate === 'string' && titleCandidate.trim().length
      ? titleCandidate
      : 'ManyChat';

  return ensureMessageText({
    id,
    receivedAt: message.receivedAt ?? Date.now(),
    source: message.source ?? 'manychat:api',
    title,
    handle: message.handle ?? null,
    fullName: message.fullName ?? null,
    text: message.text ?? '',
    raw: message.raw,
  });
}

async function readRequestPayload(req: NextRequest): Promise<unknown> {
  let bodyText: string | null = null;

  try {
    bodyText = await req.text();
  } catch {
    bodyText = null;
  }

  if (!bodyText) {
    return {};
  }

  const trimmed = bodyText.trim();
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';

  // Спробуємо спочатку розпарсити як JSON — ManyChat зазвичай шле саме такий формат.
  if (trimmed) {
    try {
      return JSON.parse(trimmed) as unknown;
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
      return record;
    } catch {
      // якщо не вдалося — впадемо до текстового варіанта нижче
    }
  }

  return { text: bodyText, raw: bodyText };
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

  const payload = await readRequestPayload(req);

  const message = normalisePayload(payload);
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

  if (apiKeyAvailable) {
    try {
      const { messages, meta } = await fetchManychatLatest(5);
      if (messages.length > 0) {
        const start = sequence;
        const apiFeed = messages.map((msg, index) => fromManychatApi(msg, start + index + 1));
        sequence = start + messages.length;
        feed = apiFeed;
        latest = apiFeed[0];
        source = 'api';
        diagnostics.api = { ok: true, url: meta.url, note: 'fetched' };
      } else {
        diagnostics.api = { ok: true, url: meta.url, note: 'empty' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.api = { ok: false, message };
    }
  } else {
    diagnostics.api = {
      ok: false,
      message:
        'MANYCHAT_API_KEY (або еквівалентний ManyChat API ключ) не налаштовано',
    };
  }

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

  if (!source && feed.length > 0) {
    source = 'kv';
  }

  if (feed.length > 0) {
    feed = feed.map((item) => ensureMessageText(item, trace));
    if (latest) {
      latest = ensureMessageText(latest, trace);
    }
  } else if (latest) {
    latest = ensureMessageText(latest, trace);
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
    source,
    trace,
    diagnostics,
  });
}
