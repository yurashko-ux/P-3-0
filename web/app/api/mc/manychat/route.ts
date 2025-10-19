// web/app/api/mc/manychat/route.ts
// Спрощений ManyChat webhook: лише фіксує останнє повідомлення в пам'яті
// й повертає його для тестової адмін-сторінки.

import { NextRequest, NextResponse } from 'next/server';
import { getEnvValue, hasEnvValue } from '@/lib/env';
import { getKvConfigStatus } from '@/lib/kv';
import { normalizeManyChat } from '@/lib/ingest';
import {
  routeManychatMessage,
  type ManychatRoutingError,
  type ManychatRoutingSuccess,
} from '@/lib/manychat-routing';
import {
  MANYCHAT_MESSAGE_KEY,
  MANYCHAT_TRACE_KEY,
  MANYCHAT_FEED_KEY,
  MANYCHAT_RAW_KEY,
  MANYCHAT_REQUEST_KEY,
  MANYCHAT_AUTOMATION_KEY,
  persistManychatSnapshot,
  persistManychatAutomation,
  readManychatMessage,
  readManychatTrace,
  readManychatFeed,
  ensureManychatFeedSnapshot,
  readManychatRaw,
  readManychatRequest,
  readManychatAutomation,
  type ManychatStoredMessage,
  type ManychatWebhookTrace,
  type ManychatRequestSnapshot,
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
  kvRequest?: {
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
  automationReplay?: {
    used: boolean;
    reason: string;
  } | null;
  automation?: {
    ok: boolean;
    error?: string;
    source: 'memory' | 'kv' | 'miss' | 'error';
    receivedAt?: number;
    message?: string;
  } | null;
};

let lastMessage: LatestMessage | null = null;
let lastTrace: WebhookTrace | null = null;
let sequence = 0;
let lastAutomation: ManychatRoutingSuccess | ManychatRoutingError | null = null;

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

function extractTextFromRaw(raw: unknown, visited: WeakSet<Record<string, unknown>> = new WeakSet()): string | null {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const nested = extractTextFromRaw(parsed, visited);
        return nested ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return null;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const nested = extractTextFromRaw(item, visited);
      if (nested) return nested;
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

  const nestedKeys = [
    'text',
    'message',
    'content',
    'body',
    'payload',
    'data',
    'event',
    'last_message',
    'lastMessage',
    'last_message_text',
    'lastMessageText',
    'last_message_preview',
    'lastMessagePreview',
  ];

  for (const key of nestedKeys) {
    if (!(key in record)) continue;
    const nested = extractTextFromRaw(record[key], visited);
    if (nested) return nested;
  }

  for (const value of Object.values(record)) {
    const nested = extractTextFromRaw(value, visited);
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

function ensureMessageText(
  message: LatestMessage | null,
  fallbackRaw: unknown,
  fallbackRawText: string | null,
): LatestMessage | null {
  if (!message) return null;

  const currentText = typeof message.text === 'string' ? message.text.trim() : '';
  if (currentText.length) {
    return currentText === message.text ? message : { ...message, text: currentText };
  }

  const candidates: Array<unknown> = [
    message.rawText,
    message.raw,
    fallbackRawText,
    fallbackRaw,
  ];

  for (const candidate of candidates) {
    if (candidate == null) continue;

    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const extracted = extractTextFromRaw(parsed);
          if (extracted && extracted.trim().length) {
            return { ...message, text: extracted.trim(), rawText: trimmed };
          }
        } catch {
          if (trimmed.length) {
            return { ...message, text: trimmed, rawText: trimmed };
          }
        }
      }
      continue;
    }

    const extracted = extractTextFromRaw(candidate);
    if (extracted && extracted.trim().length) {
      return { ...message, text: extracted.trim() };
    }
  }

  return message;
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

  let automation: ManychatRoutingSuccess | ManychatRoutingError;

  try {
    const payloadRecord =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    const nestedMessage = payloadRecord.message as Record<string, unknown> | undefined;
    const nestedData = payloadRecord.data as Record<string, unknown> | undefined;
    const nestedSubscriber = payloadRecord.subscriber as Record<string, unknown> | undefined;
    const nestedUser = payloadRecord.user as Record<string, unknown> | undefined;

    const normalized = normalizeManyChat({
      username: pickFirstString(
        message.handle,
        payloadRecord.username,
        payloadRecord.handle,
        nestedMessage?.username,
        nestedMessage?.handle,
        nestedSubscriber?.username,
        nestedUser?.username,
      ),
      text: pickFirstString(
        message.text,
        payloadRecord.text,
        nestedMessage?.text,
        nestedData?.text,
        (nestedMessage?.message as Record<string, unknown> | undefined)?.text,
        (payloadRecord.message as Record<string, unknown> | undefined)?.text,
      ),
      full_name: pickFirstString(
        message.fullName,
        payloadRecord.full_name,
        payloadRecord.name,
        nestedSubscriber?.name,
        nestedUser?.full_name,
      ),
      first_name: pickFirstString(
        payloadRecord.first_name,
        nestedSubscriber?.first_name,
        nestedUser?.first_name,
      ),
      last_name: pickFirstString(
        payloadRecord.last_name,
        nestedSubscriber?.last_name,
        nestedUser?.last_name,
      ),
    });

    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host =
      req.headers.get('x-forwarded-host') ??
      req.headers.get('host');

    if (!host) {
      automation = {
        ok: false,
        error: 'host_header_missing',
        details: { message: 'Відсутній host-header під час виконання автоматизації' },
      };
    } else {
      const moveEndpoint = `${proto}://${host}/api/keycrm/card/move`;
      const bypassHeader = req.headers.get("x-vercel-protection-bypass");
      const bypassSecret = req.headers.get("x-vercel-protection-bypass-secret");
      const identityCandidates = [
        { kind: 'webhook_handle', value: message.handle ?? null },
        { kind: 'webhook_fullName', value: message.fullName ?? null },
        { kind: 'payload_username', value: pickFirstString(payloadRecord.username, payloadRecord.handle) },
        { kind: 'message_username', value: pickFirstString(nestedMessage?.username, nestedMessage?.handle) },
        { kind: 'subscriber_username', value: pickFirstString(nestedSubscriber?.username) },
        { kind: 'user_username', value: pickFirstString(nestedUser?.username) },
      ];

      automation = await routeManychatMessage({
        normalized,
        identityCandidates,
        performMove: async ({ cardId, pipelineId, statusId }) => {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            accept: "application/json",
          };

          if (bypassHeader) {
            headers["x-vercel-protection-bypass"] = bypassHeader;
          }

          if (bypassSecret) {
            headers["x-vercel-protection-bypass-secret"] = bypassSecret;
          }

          const res = await fetch(moveEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              card_id: cardId,
              to_pipeline_id: pipelineId,
              to_status_id: statusId,
            }),
            cache: 'no-store',
          });

          const jsonBody = await res.json().catch(() => null);
          const okResult = res.ok && jsonBody && typeof jsonBody === 'object' && jsonBody.ok !== false;
          if (!okResult) {
            return {
              ok: false,
              status: res.status,
              response: jsonBody,
            };
          }
          return {
            ok: true,
            status: res.status,
            response: jsonBody,
          };
        },
      });
    }
  } catch (err) {
    automation = {
      ok: false,
      error: 'automation_exception',
      details: err instanceof Error ? { message: err.message } : { message: String(err) },
    };
  }

  if (automation) {
    try {
      await persistManychatAutomation(automation);
    } catch (err) {
      console.error('[manychat] Не вдалося зберегти автоматизацію у KV:', err);
    }
  }

  lastAutomation = automation;

  return NextResponse.json({ ok: true, message, automation });
}

export async function GET(req: NextRequest) {
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
  let automation = lastAutomation;
  let automationSource: 'memory' | 'kv' | 'miss' | 'error' | null = automation ? 'memory' : null;
  let automationReceivedAt: number | undefined;
  let automationErrorMessage: string | null = null;

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

  const requestResult = await readManychatRequest();
  let requestSnapshot: ManychatRequestSnapshot | null = null;
  if (requestResult.snapshot) {
    requestSnapshot = requestResult.snapshot;
    diagnostics.kvRequest = {
      ok: true,
      key: MANYCHAT_REQUEST_KEY,
      source: 'kv',
    };
  } else if (requestResult.error) {
    diagnostics.kvRequest = {
      ok: false,
      key: MANYCHAT_REQUEST_KEY,
      source: 'error',
      message: requestResult.error,
    };
  } else {
    diagnostics.kvRequest = {
      ok: false,
      key: MANYCHAT_REQUEST_KEY,
      source: 'miss',
      message: 'KV не містить останній сирий запит ManyChat',
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

  if (!automation) {
    const {
      snapshot: automationSnapshot,
      source: automationStoreSource,
      error: automationStoreError,
    } = await readManychatAutomation();

    if (automationSnapshot) {
      automation = automationSnapshot.result;
      automationSource = 'kv';
      automationReceivedAt = automationSnapshot.receivedAt;
      lastAutomation = automation;
    } else if (automationStoreError) {
      automationSource = 'error';
      automationErrorMessage = automationStoreError;
    } else {
      automationSource = 'miss';
    }
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

  const ensureMessageContent = (message: LatestMessage): LatestMessage => {
    if (!message) return message;
    const enriched: LatestMessage = { ...message };
    const hasRaw = enriched.raw !== undefined && enriched.raw !== null;
    const rawCandidate = hasRaw ? enriched.raw : rawResult.raw;

    if (!hasRaw && rawResult.raw !== undefined && rawResult.raw !== null) {
      enriched.raw = rawResult.raw;
    }

    const currentRawText = typeof enriched.rawText === 'string' ? enriched.rawText.trim() : '';
    if (!currentRawText.length) {
      if (typeof rawCandidate === 'string' && rawCandidate.trim().length) {
        enriched.rawText = rawCandidate;
      } else if (rawResult.text && rawResult.text.trim().length) {
        enriched.rawText = rawResult.text;
      } else if (rawCandidate != null) {
        try {
          enriched.rawText = JSON.stringify(rawCandidate);
        } catch {
          // ignore serialisation errors
        }
      }
    }

    const currentText = typeof enriched.text === 'string' ? enriched.text.trim() : '';
    if (!currentText.length) {
      const textFromRaw = extractTextFromRaw(rawCandidate);
      if (textFromRaw && textFromRaw.trim().length) {
        enriched.text = textFromRaw.trim();
      } else if (typeof enriched.rawText === 'string' && enriched.rawText.trim().length) {
        try {
          const parsedRawText = JSON.parse(enriched.rawText) as unknown;
          const parsedText = extractTextFromRaw(parsedRawText);
          if (parsedText && parsedText.trim().length) {
            enriched.text = parsedText.trim();
          }
        } catch {
          const plain = enriched.rawText.trim();
          if (plain.length) {
            enriched.text = plain;
          }
        }
      } else if (trace?.messagePreview && trace.messagePreview.trim().length) {
        enriched.text = trace.messagePreview.trim();
      }
    }

    return enriched;
  };

  if (latest) {
    latest = ensureMessageContent(latest);
  }

  if (feed.length) {
    feed = feed.map(ensureMessageContent);
  }

  if (!source && feed.length > 0) {
    source = 'kv';
  }

  let automationReplay: Diagnostics['automationReplay'] = null;

  const combinedRaw = (() => {
    if (rawResult.raw !== undefined && rawResult.raw !== null) {
      return rawResult.raw;
    }
    if (latest?.raw !== undefined && latest?.raw !== null) {
      return latest.raw;
    }
    if (requestSnapshot?.rawText) {
      try {
        return JSON.parse(requestSnapshot.rawText) as unknown;
      } catch {
        return requestSnapshot.rawText;
      }
    }
    return null;
  })();

  const combinedRawText = (() => {
    const textCandidate = typeof rawResult.text === 'string' && rawResult.text.trim().length
      ? rawResult.text
      : null;
    if (textCandidate) return textCandidate;
    if (typeof requestSnapshot?.rawText === 'string' && requestSnapshot.rawText.trim().length) {
      return requestSnapshot.rawText;
    }
    if (typeof latest?.rawText === 'string' && latest.rawText.trim().length) {
      return latest.rawText;
    }
    if (combinedRaw != null) {
      try {
        return JSON.stringify(combinedRaw);
      } catch {
        /* ignore */
      }
    }
    return null;
  })();

  if (latest && typeof combinedRawText === 'string' && combinedRawText.trim().length && (!latest.rawText || !latest.rawText.trim().length)) {
    latest = { ...latest, rawText: combinedRawText };
  }

  if (feed.length) {
    feed = feed.map((item, index) => {
      let next = item;
      if (
        index === 0 &&
        typeof combinedRawText === 'string' &&
        combinedRawText.trim().length &&
        (!item.rawText || !item.rawText.trim().length)
      ) {
        next = { ...item, rawText: combinedRawText };
      }
      const fallbackText = combinedRawText ?? requestSnapshot?.rawText ?? rawResult.text ?? null;
      const ensured = ensureMessageText(next, combinedRaw ?? rawResult.raw, fallbackText);
      return ensured ?? next;
    });
  }

  if (latest) {
    const fallbackText = combinedRawText ?? requestSnapshot?.rawText ?? rawResult.text ?? null;
    latest = ensureMessageText(latest, combinedRaw ?? rawResult.raw, fallbackText);
  }

  if (!automation) {
    const candidateMessage = latest ?? (feed.length ? feed[0] : null);

    const parseRecord = (input: unknown): Record<string, unknown> | null => {
      if (!input) return null;
      if (typeof input === 'string') {
        try {
          const parsed = JSON.parse(input) as unknown;
          return parseRecord(parsed);
        } catch {
          return null;
        }
      }
      if (typeof input === 'object' && !Array.isArray(input)) {
        return input as Record<string, unknown>;
      }
      return null;
    };

    const payloadRecord =
      parseRecord(combinedRaw) ??
      parseRecord(combinedRawText) ??
      parseRecord(requestSnapshot?.rawText ?? null);

    const nestedMessage = payloadRecord?.message as Record<string, unknown> | undefined;
    const nestedData = payloadRecord?.data as Record<string, unknown> | undefined;
    const nestedSubscriber = payloadRecord?.subscriber as Record<string, unknown> | undefined;
    const nestedUser = payloadRecord?.user as Record<string, unknown> | undefined;

    const normalizedReplay = normalizeManyChat({
      username: pickFirstString(
        candidateMessage?.handle,
        candidateMessage?.handle ? `@${candidateMessage.handle}` : null,
        payloadRecord?.username,
        payloadRecord?.handle,
        nestedMessage?.username,
        nestedMessage?.handle,
        nestedSubscriber?.username,
        nestedUser?.username,
      ),
      text: pickFirstString(
        candidateMessage?.text,
        payloadRecord?.text,
        nestedMessage?.text,
        nestedData?.text,
        typeof combinedRawText === 'string' ? combinedRawText : null,
        requestSnapshot?.rawText ?? null,
        trace?.messagePreview ?? null,
      ),
      full_name: pickFirstString(
        candidateMessage?.fullName,
        payloadRecord?.full_name,
        payloadRecord?.name,
        nestedSubscriber?.name,
        nestedUser?.full_name,
        trace?.fullName ?? null,
      ),
      first_name: pickFirstString(
        payloadRecord?.first_name,
        nestedSubscriber?.first_name,
        nestedUser?.first_name,
      ),
      last_name: pickFirstString(
        payloadRecord?.last_name,
        nestedSubscriber?.last_name,
        nestedUser?.last_name,
      ),
    });

    const identityCandidates = [
      { kind: 'message_handle', value: candidateMessage?.handle ?? null },
      {
        kind: 'message_handle_raw',
        value: candidateMessage?.handle ? `@${candidateMessage.handle}` : null,
      },
      { kind: 'message_fullName', value: candidateMessage?.fullName ?? null },
      { kind: 'normalized_handle', value: normalizedReplay.handle ?? null },
      { kind: 'normalized_handle_raw', value: normalizedReplay.handleRaw ?? null },
      { kind: 'normalized_fullName', value: normalizedReplay.fullName ?? null },
      { kind: 'payload_username', value: pickFirstString(payloadRecord?.username, payloadRecord?.handle) },
      { kind: 'payload_message_username', value: pickFirstString(nestedMessage?.username, nestedMessage?.handle) },
      { kind: 'payload_subscriber_username', value: pickFirstString(nestedSubscriber?.username) },
      { kind: 'payload_user_username', value: pickFirstString(nestedUser?.username) },
    ];

    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const moveEndpoint = host ? `${proto}://${host}/api/keycrm/card/move` : null;

    try {
      const replayResult = await routeManychatMessage({
        normalized: normalizedReplay,
        identityCandidates,
        performMove: moveEndpoint
          ? async ({ cardId, pipelineId, statusId }) => {
              const res = await fetch(moveEndpoint, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  accept: 'application/json',
                },
                body: JSON.stringify({
                  card_id: cardId,
                  to_pipeline_id: pipelineId,
                  to_status_id: statusId,
                }),
                cache: 'no-store',
              });

              const jsonBody = await res.json().catch(() => null);
              const okResult = res.ok && jsonBody && typeof jsonBody === 'object' && jsonBody.ok !== false;
              if (!okResult) {
                return {
                  ok: false as const,
                  status: res.status,
                  response: jsonBody,
                };
              }
              return {
                ok: true as const,
                status: res.status,
                response: jsonBody,
              };
            }
          : undefined,
      });

      automation = replayResult;
      automationSource = moveEndpoint ? 'memory' : automationSource ?? 'memory';
      automationReceivedAt = Date.now();
      lastAutomation = automation;

      automationReplay = {
        used: true,
        reason: moveEndpoint
          ? 'Автоматизацію виконано повторно під час GET, оскільки результат не знайдено у KV.'
          : 'Автоматизацію проаналізовано повторно без переміщення (відсутня адреса moveEndpoint).',
      };

      try {
        await persistManychatAutomation(replayResult);
      } catch (error) {
        automationErrorMessage =
          error instanceof Error ? error.message : typeof error === 'string' ? error : automationErrorMessage;
      }
    } catch (error) {
      automationSource = 'error';
      automationErrorMessage =
        error instanceof Error ? error.message : typeof error === 'string' ? error : automationErrorMessage;
    }
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

  diagnostics.automationReplay = automationReplay;

  diagnostics.automation = (() => {
    if (automation) {
      if (automation.ok) {
        return {
          ok: true,
          source: automationSource ?? 'memory',
          receivedAt: automationReceivedAt,
          message: automationErrorMessage ?? undefined,
        } satisfies Diagnostics['automation'];
      }

      const automationError = automation as ManychatRoutingError;
      return {
        ok: false,
        error: automationError.error,
        source: automationSource ?? 'memory',
        receivedAt: automationReceivedAt,
        message: automationErrorMessage ?? undefined,
      } satisfies Diagnostics['automation'];
    }

    if (automationSource === 'error') {
      return {
        ok: false,
        error: automationErrorMessage ?? 'Не вдалося прочитати автоматизацію',
        source: 'error',
        message: automationErrorMessage ?? undefined,
      } satisfies Diagnostics['automation'];
    }

    if (automationSource === 'miss') {
      return {
        ok: false,
        source: 'miss',
        message: 'Автоматизацію ще не запускали в цьому середовищі.',
      } satisfies Diagnostics['automation'];
    }

    return null;
  })();

  return NextResponse.json({
    ok: true,
    latest: latest ?? null,
    feed,
    messages: feed,
    source,
    trace,
    diagnostics,
    automation: automation ?? null,
    rawSnapshot: {
      raw: combinedRaw,
      text: combinedRawText ?? null,
      rawText: combinedRawText ?? null,
      source:
        rawResult.source ??
        requestResult.source ??
        (combinedRawText ? 'message' : null),
    },
    requestSnapshot: requestSnapshot
      ? {
          rawText: requestSnapshot.rawText,
          receivedAt: requestSnapshot.receivedAt,
          source: requestSnapshot.source ?? requestResult.source ?? 'kv',
        }
      : null,
  });
}
