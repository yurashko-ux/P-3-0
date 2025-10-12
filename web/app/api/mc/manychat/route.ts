// web/app/api/mc/manychat/route.ts
// Спрощений ManyChat webhook: лише фіксує останнє повідомлення в пам'яті
// й повертає його для тестової адмін-сторінки.

import { NextRequest, NextResponse } from 'next/server';
import { getEnvValue, hasEnvValue } from '@/lib/env';
import { kvRead } from '@/lib/kv';
import {
  MANYCHAT_MESSAGE_KEY,
  MANYCHAT_TRACE_KEY,
  persistManychatSnapshot,
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
  kv?: {
    ok: boolean;
    key: string;
    source: 'memory' | 'kv' | 'miss' | 'error';
    message?: string;
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

  return {
    id: ++sequence,
    receivedAt: Date.now(),
    source: 'webhook:/api/mc/manychat',
    title,
    handle,
    fullName,
    text,
    raw: payload,
  };
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

  return {
    id,
    receivedAt: message.receivedAt ?? Date.now(),
    source: message.source ?? 'manychat:api',
    title,
    handle: message.handle ?? null,
    fullName: message.fullName ?? null,
    text: message.text ?? '',
    raw: message.raw,
  };
}

export async function POST(req: NextRequest) {
  const mcToken = getEnvValue('MC_TOKEN');
  const headerToken =
    req.headers.get('x-mc-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

  if (mcToken && headerToken && headerToken !== mcToken) {
    lastTrace = {
      receivedAt: Date.now(),
      status: 'rejected',
      reason: 'Невірний токен авторизації',
      statusCode: 401,
    };
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    lastTrace = {
      receivedAt: Date.now(),
      status: 'rejected',
      reason: 'Некоректний JSON у тілі запиту',
      statusCode: 400,
    };
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const message = normalisePayload(payload);
  lastMessage = message;
  lastTrace = {
    receivedAt: message.receivedAt,
    status: 'accepted',
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

  let source: 'memory' | 'kv' | 'api' | null = lastMessage ? 'memory' : null;
  let latest = lastMessage;
  let trace = lastTrace;

  if (latest) {
    diagnostics.kv = { ok: true, key: MANYCHAT_MESSAGE_KEY, source: 'memory' };
  } else {
    try {
      const raw = await kvRead.getRaw(MANYCHAT_MESSAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LatestMessage;
        latest = {
          ...parsed,
          receivedAt:
            typeof parsed?.receivedAt === 'number' ? parsed.receivedAt : Date.now(),
        };
        source = 'kv';
        diagnostics.kv = { ok: true, key: MANYCHAT_MESSAGE_KEY, source: 'kv' };
      } else {
        diagnostics.kv = {
          ok: false,
          key: MANYCHAT_MESSAGE_KEY,
          source: 'miss',
          message: 'KV не містить збереженого повідомлення',
        };
      }
    } catch (error) {
      diagnostics.kv = {
        ok: false,
        key: MANYCHAT_MESSAGE_KEY,
        source: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!trace) {
    try {
      const rawTrace = await kvRead.getRaw(MANYCHAT_TRACE_KEY);
      if (rawTrace) {
        trace = JSON.parse(rawTrace) as WebhookTrace;
      }
    } catch {
      // ignore trace hydration failures
    }
  }

  let feed: LatestMessage[] = latest ? [latest] : [];

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

  return NextResponse.json({
    ok: true,
    latest: latest ?? null,
    feed,
    source,
    trace,
    diagnostics,
  });
}
