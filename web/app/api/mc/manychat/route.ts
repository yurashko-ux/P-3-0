// web/app/api/mc/manychat/route.ts
// Спрощений ManyChat webhook: лише фіксує останнє повідомлення в пам'яті
// й повертає його для тестової адмін-сторінки.

import { NextRequest, NextResponse } from 'next/server';
import { getEnvValue, hasEnvValue } from '@/lib/env';
import { kvRead, kvWrite } from '@/lib/kv';
import { fetchManychatLatest, type ManychatLatestMessage } from '@/lib/manychat-api';

type LatestMessage = {
  id: number | string;
  receivedAt: number;
  source: string;
  title: string;
  handle: string | null;
  fullName: string | null;
  text: string;
  raw: unknown;
};

type WebhookTrace = {
  receivedAt: number;
  status: 'accepted' | 'rejected';
  reason?: string | null;
  statusCode?: number | null;
  handle?: string | null;
  fullName?: string | null;
  messagePreview?: string | null;
};

let lastMessage: LatestMessage | null = null;
let lastTrace: WebhookTrace | null = null;
let sequence = 0;

const KV_MESSAGE_KEY = 'manychat:last-message';
const KV_TRACE_KEY = 'manychat:last-trace';

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
    await kvWrite.setRaw(KV_MESSAGE_KEY, JSON.stringify(message));
    await kvWrite.setRaw(KV_TRACE_KEY, JSON.stringify(lastTrace));
  } catch {
    // ignore kv persistence failures; in-memory fallback will still work
  }

  return NextResponse.json({ ok: true, message });
}

export async function GET() {
  const diagnostics: Record<string, unknown> = {};
  const apiKeyAvailable = hasEnvValue(
    'MANYCHAT_API_KEY',
    'MANYCHAT_API_TOKEN',
    'MC_API_KEY',
  );

  if (apiKeyAvailable) {
    try {
      const { messages, meta } = await fetchManychatLatest(5);
      if (messages.length > 0) {
        const start = sequence;
        const feed = messages.map((msg, index) => fromManychatApi(msg, start + index + 1));
        sequence = start + messages.length;
        const latest = feed[0];
        return NextResponse.json({
          ok: true,
          latest,
          feed,
          source: meta.source,
          trace: lastTrace,
          diagnostics: { ...diagnostics, api: { ok: true, url: meta.url } },
        });
      }
      diagnostics.api = { ok: true, url: meta.url, note: 'empty' };
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

  let source: 'memory' | 'kv' = 'memory';
  let latest = lastMessage;
  let trace = lastTrace;

  if (!latest) {
    try {
      const raw = await kvRead.getRaw(KV_MESSAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LatestMessage;
        latest = {
          ...parsed,
          receivedAt: typeof parsed?.receivedAt === 'number' ? parsed.receivedAt : Date.now(),
        };
        source = 'kv';
      }
      diagnostics.kv = { ok: Boolean(latest), source: 'get', key: KV_MESSAGE_KEY };
    } catch (error) {
      diagnostics.kv = {
        ok: false,
        source: 'get',
        key: KV_MESSAGE_KEY,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!trace) {
    try {
      const rawTrace = await kvRead.getRaw(KV_TRACE_KEY);
      if (rawTrace) {
        trace = JSON.parse(rawTrace) as WebhookTrace;
      }
    } catch {
      // ignore trace hydration failures
    }
  }

  if (!latest) {
    return NextResponse.json({ ok: true, latest: null, feed: [], trace, diagnostics });
  }

  return NextResponse.json({
    ok: true,
    latest,
    feed: [latest],
    source,
    trace,
    diagnostics,
  });
}
