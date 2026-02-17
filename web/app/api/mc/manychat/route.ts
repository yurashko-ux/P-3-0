// web/app/api/mc/manychat/route.ts
// Спрощений ManyChat webhook: лише фіксує останнє повідомлення в пам'яті
// й повертає його для тестової адмін-сторінки.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { getEnvValue, hasEnvValue } from '@/lib/env';
import { getKvConfigStatus, kvRead, kvWrite, campaignKeys } from '@/lib/kv';
import { normalizeManyChat } from '@/lib/ingest';
import {
  routeManychatMessage,
  type ManychatRoutingError,
  type ManychatRoutingSuccess,
} from '@/lib/manychat-routing';
import { moveKeycrmCard } from '@/lib/keycrm-move';
import { normalizeCampaignShape } from '@/lib/campaign-shape';
import { normalizeInstagram } from '@/lib/normalize';
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

function pickAvatarUrlFromRaw(raw: unknown): string | null {
  const visited = new WeakSet<Record<string, unknown>>();
  const avatarKeyHints = [
    'avatar',
    'profile_pic',
    'profilepic',
    'profile_picture',
    'picture',
    'photo',
    'image',
    'profile_photo',
  ];

  const isLikelyUrl = (value: string): boolean => {
    const v = value.trim();
    if (!/^https?:\/\//i.test(v)) return false;
    return true;
  };

  const walk = (node: unknown, depth: number): string | null => {
    if (node == null) return null;
    if (depth > 8) return null;

    if (typeof node === 'string') {
      return isLikelyUrl(node) ? node.trim() : null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof node !== 'object') return null;

    const rec = node as Record<string, unknown>;
    if (visited.has(rec)) return null;
    visited.add(rec);

    // 1) Спочатку шукаємо значення в “очевидних” ключах.
    for (const [k, v] of Object.entries(rec)) {
      const key = k.toLowerCase();
      if (!avatarKeyHints.some((h) => key.includes(h))) continue;
      const candidate = walk(v, depth + 1);
      if (candidate) return candidate;
    }

    // 2) Потім — будь-який URL в піддереві.
    for (const v of Object.values(rec)) {
      const candidate = walk(v, depth + 1);
      if (candidate) return candidate;
    }

    return null;
  };

  return walk(raw, 0);
}

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
const directSubscriberKey = (username: string) => `direct:ig-subscriber:${username.toLowerCase()}`;

function getManyChatApiKey(): string | null {
  const key = getEnvValue(
    'MANYCHAT_API_KEY',
    'ManyChat_API_Key',
    'MANYCHAT_API_TOKEN',
    'MC_API_KEY',
    'MANYCHAT_APIKEY',
  );
  const t = typeof key === 'string' ? key.trim() : '';
  return t ? t : null;
}

function pickSubscriberIdFromRaw(raw: unknown, rawText?: string | null): string | null {
  // 1) JSON обʼєкт (payload)
  try {
    const obj = raw && typeof raw === 'object' ? (raw as any) : null;
    const direct =
      obj?.subscriber?.id ||
      obj?.subscriber?.subscriber_id ||
      obj?.subscriber_id ||
      obj?.subscriberId ||
      null;
    if (direct != null && String(direct).trim()) return String(direct).trim();
  } catch {
    // ignore
  }

  const text = typeof rawText === 'string' ? rawText : null;
  if (!text) return null;

  // 2) x-www-form-urlencoded (subscriber[id]=... або subscriber_id=...)
  try {
    const params = new URLSearchParams(text);
    const v =
      params.get('subscriber[id]') ||
      params.get('subscriber_id') ||
      params.get('subscriberId') ||
      params.get('subscriber.id') ||
      null;
    if (v && String(v).trim()) return String(v).trim();
  } catch {
    // ignore
  }

  // 3) regex (на випадок “майже JSON”)
  const m1 = text.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*"([^"]+)"/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = text.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*(\d+)/i);
  if (m2?.[1]) return m2[1].trim();
  const m3 = text.match(/"subscriber_id"\s*:\s*"([^"]+)"/i);
  if (m3?.[1]) return m3[1].trim();
  const m4 = text.match(/"subscriber_id"\s*:\s*(\d+)/i);
  if (m4?.[1]) return m4[1].trim();
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

function isTemplateOrPlaceholderName(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  // ManyChat/templating placeholders або наші fallback-и
  if (v.includes('{{') || v.includes('}}')) return true;
  if (lower === 'not found') return true;
  return false;
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

async function readRequestPayloadFromText(bodyText: string): Promise<{ parsed: unknown; rawText: string | null }> {
  if (!bodyText) {
    return { parsed: {}, rawText: null };
  }

  const trimmed = bodyText.trim();

  // Спробуємо спочатку розпарсити як JSON — ManyChat зазвичай шле саме такий формат.
  if (trimmed) {
    try {
      return { parsed: JSON.parse(trimmed) as unknown, rawText: bodyText };
    } catch {
      // ігноруємо, переходимо до альтернативних варіантів
    }
  }

  return { parsed: { text: bodyText, raw: bodyText }, rawText: bodyText };
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
  console.log('[manychat] 📨 POST request received');
  
  // Читаємо body один раз і зберігаємо для подальшого використання
  let rawBodyText: string | null = null;
  try {
    rawBodyText = await req.text();
    
    // Зберігаємо вебхук в лог для діагностики
    const extractSubscriberId = (raw: string): string | null => {
      const trimmed = raw.trim();
      if (!trimmed) return null;

      // 1) x-www-form-urlencoded / querystring (subscriber[id]=... або subscriber_id=...)
      // ManyChat інколи шле External Request саме так.
      try {
        const params = new URLSearchParams(trimmed);
        const v =
          params.get('subscriber[id]') ||
          params.get('subscriber_id') ||
          params.get('subscriberId') ||
          params.get('subscriber.id') ||
          params.get('subscriber[id]'.replace('[', '%5B').replace(']', '%5D')) || // на всякий випадок
          null;
        if (v && String(v).trim()) return String(v).trim();
      } catch {
        // ignore
      }

      try {
        const parsed = JSON.parse(trimmed) as any;
        const direct =
          parsed?.subscriber?.id ||
          parsed?.subscriber?.subscriber_id ||
          parsed?.subscriber_id ||
          parsed?.subscriberId ||
          parsed?.id ||
          null;
        if (direct != null && String(direct).trim()) return String(direct).trim();
      } catch {
        // ignore, fallback to regex below
      }

      // fallback regex: subscriber.id / subscriber_id
      const m1 = raw.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*"([^"]+)"/i);
      if (m1?.[1]) return m1[1].trim();
      const m2 = raw.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*(\d+)/i);
      if (m2?.[1]) return m2[1].trim();
      const m3 = raw.match(/"subscriber_id"\s*:\s*"([^"]+)"/i);
      if (m3?.[1]) return m3[1].trim();
      const m4 = raw.match(/"subscriber_id"\s*:\s*(\d+)/i);
      if (m4?.[1]) return m4[1].trim();
      return null;
    };

    const subscriberId = extractSubscriberId(rawBodyText);
    const logEntry = {
      receivedAt: new Date().toISOString(),
      subscriberId,
      // Потрібно бачити subscriber.id, тому тримаємо більше. (Безпека: не зберігаємо безмежно)
      rawBody: rawBodyText.substring(0, 20000), // Перші 20000 символів
      bodyLength: rawBodyText.length,
      headers: {
        'x-mc-token': req.headers.get('x-mc-token') || null,
        'authorization': req.headers.get('authorization') ? '***' : null,
        'content-type': req.headers.get('content-type') || null,
      },
    };
    const payload = JSON.stringify(logEntry);
    await kvWrite.lpush('manychat:webhook:log', payload);
    // Залишаємо лише останні 1000 вебхуків (збільшено для синхронізації за кілька днів)
    await kvWrite.ltrim('manychat:webhook:log', 0, 999);
    console.log('[manychat] ✅ Webhook logged to KV');
  } catch (logErr) {
    console.warn('[manychat] Failed to persist webhook to log:', logErr);
  }
  
  try {
    console.log('[manychat] Step 1: Checking authentication');
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

    console.log('[manychat] Step 2: Reading request payload');
    let payload: unknown;
    let rawText: string;
    try {
      // Якщо body вже прочитано для логування, використовуємо його
      const result = rawBodyText 
        ? await readRequestPayloadFromText(rawBodyText)
        : await readRequestPayload(req);
      payload = result.parsed;
      rawText = result.rawText;
      console.log('[manychat] Step 2: Request payload read successfully');
      
      // Логуємо структуру payload для діагностики
      if (payload && typeof payload === 'object') {
        const payloadObj = payload as Record<string, unknown>;
        console.log('[manychat] 📦 Payload structure:', {
          hasHandle: 'handle' in payloadObj || 'username' in payloadObj,
          hasSubscriber: 'subscriber' in payloadObj,
          hasUser: 'user' in payloadObj,
          hasMessage: 'message' in payloadObj,
          hasText: 'text' in payloadObj,
          topLevelKeys: Object.keys(payloadObj).slice(0, 10),
        });
      }
    } catch (err) {
      console.error('[manychat] Step 2: Failed to read request payload:', err);
      throw err;
    }

    console.log('[manychat] Step 3: Normalizing payload');
    let message: ReturnType<typeof normalisePayload>;
    try {
      message = normalisePayload(payload, rawText);
      console.log('[manychat] Step 3: Payload normalized successfully');
      console.log('[manychat] 📝 Extracted data:', {
        handle: message.handle || 'NOT FOUND',
        fullName: message.fullName || 'NOT FOUND',
        textLength: message.text?.length || 0,
        textPreview: message.text?.slice(0, 100) || 'EMPTY',
      });
    } catch (err) {
      console.error('[manychat] Step 3: Failed to normalize payload:', err);
      throw err;
    }
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

  // Синхронізація з Direct розділом (якщо є Instagram username)
  console.log('[manychat] Direct sync check:', {
    hasHandle: !!message.handle,
    handle: message.handle,
    hasText: !!message.text,
    textPreview: message.text?.slice(0, 50),
    hasFullName: !!message.fullName,
    fullName: message.fullName,
  });

  if (message.handle && message.handle.trim()) {
    try {
      // Викликаємо синхронізацію напряму (внутрішній виклик, не через HTTP)
      const { getDirectClientByInstagram, saveDirectClient, getAllDirectStatuses } = await import('@/lib/direct-store');
      
      // Нормалізуємо Instagram username (прибираємо @, протоколи, тощо)
      const normalizedInstagram = normalizeInstagram(message.handle);
      if (!normalizedInstagram) {
        console.warn('[manychat] ⚠️ Skipping Direct sync - invalid Instagram handle:', message.handle);
        // Продовжуємо виконання webhook, просто пропускаємо синхронізацію
      } else {
        console.log('[manychat] Processing Direct client sync for:', normalizedInstagram, '(original:', message.handle, ')');

        // MVP: пробуємо витягнути аватарку з raw payload і зберегти в KV (для показу в таблиці)
        try {
          const existing = await kvRead.getRaw(directAvatarKey(normalizedInstagram));
          const existingStr = typeof existing === 'string' ? existing.trim() : '';
          const hasValidExisting = Boolean(existingStr) && /^https?:\/\//i.test(existingStr);

          // 1) Найдешевше: витягнути URL з webhook payload
          const avatarFromWebhook = pickAvatarUrlFromRaw(payload);
          if (avatarFromWebhook && /^https?:\/\//i.test(avatarFromWebhook)) {
            await kvWrite.setRaw(directAvatarKey(normalizedInstagram), avatarFromWebhook);
            console.log('[manychat] 🖼️ Збережено аватарку Instagram з webhook в KV:', {
              username: normalizedInstagram,
              key: directAvatarKey(normalizedInstagram),
            });
          } else if (!hasValidExisting) {
            // 2) Якщо в payload нема аватарки — пробуємо підтягнути через ManyChat API по subscriber_id
            const subscriberId = pickSubscriberIdFromRaw(payload, rawText);
            if (subscriberId) {
              // Запамʼятаємо subscriber_id для діагностики/бекфілу
              try {
                await kvWrite.setRaw(directSubscriberKey(normalizedInstagram), String(subscriberId));
              } catch {}

              const apiKey = getManyChatApiKey();
              if (!apiKey) {
                console.warn('[manychat] 🖼️ Нема MANYCHAT API key — не можу підтягнути аватарку по subscriber_id', {
                  username: normalizedInstagram,
                  subscriberId,
                });
              } else {
                const url = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(String(subscriberId))}`;
                console.log('[manychat] 🖼️ Підтягуємо аватарку через ManyChat getInfo…', {
                  username: normalizedInstagram,
                  subscriberId,
                });
                try {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 6000);
                  const res = await fetch(url, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    signal: controller.signal,
                  }).finally(() => clearTimeout(timeout));

                  const text = await res.text();
                  if (!res.ok) {
                    console.warn('[manychat] 🖼️ getInfo не ок (аватар не підтягнувся):', {
                      status: res.status,
                      preview: text.slice(0, 240),
                      username: normalizedInstagram,
                      subscriberId,
                    });
                  } else {
                    let parsed: any = null;
                    try {
                      parsed = JSON.parse(text);
                    } catch {
                      parsed = null;
                    }
                    const avatarFromApi = pickAvatarUrlFromRaw(parsed?.data ?? parsed);
                    if (avatarFromApi && /^https?:\/\//i.test(avatarFromApi)) {
                      await kvWrite.setRaw(directAvatarKey(normalizedInstagram), avatarFromApi);
                      console.log('[manychat] 🖼️ Збережено аватарку Instagram з ManyChat API в KV:', {
                        username: normalizedInstagram,
                        key: directAvatarKey(normalizedInstagram),
                      });
                    } else {
                      console.warn('[manychat] 🖼️ getInfo успішний, але аватарку не знайшов у відповіді', {
                        username: normalizedInstagram,
                        subscriberId,
                      });
                    }
                  }
                } catch (err) {
                  console.warn('[manychat] 🖼️ Помилка getInfo (некритично):', err);
                }
              }
            } else {
              console.log('[manychat] 🖼️ subscriber_id не знайдено у webhook — аватарку не підтягую', {
                username: normalizedInstagram,
              });
            }
          }
        } catch (avatarErr) {
          console.warn('[manychat] 🖼️ Не вдалося зберегти аватарку в KV (некритично):', avatarErr);
        }
        
        let client = await getDirectClientByInstagram(normalizedInstagram);
      
      const statuses = await getAllDirectStatuses();
      const defaultStatus = statuses.find((s) => s.isDefault) || statuses[0];
      
      if (!client || !client.id) {
        // Створюємо нового клієнта
        const now = new Date().toISOString();
        const safeFullName =
          typeof message.fullName === 'string' && !isTemplateOrPlaceholderName(message.fullName)
            ? message.fullName.trim()
            : null;
        const fullNameParts = safeFullName ? safeFullName.split(/\s+/) : [];
        const clientId = `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Автоматично призначаємо дірект-менеджера для клієнтів з ManyChat
        let masterId: string | undefined = undefined;
        try {
          const { getDirectManager } = await import('@/lib/direct-masters/store');
          const directManager = await getDirectManager();
          if (directManager) {
            masterId = directManager.id;
            console.log(`[manychat] Auto-assigned direct manager ${directManager.name} (${directManager.id}) to client ${clientId}`);
          }
        } catch (err) {
          console.warn('[manychat] Failed to auto-assign direct manager:', err);
        }
        
        client = {
          id: clientId,
          instagramUsername: normalizedInstagram,
          firstName: fullNameParts[0] || undefined,
          lastName: fullNameParts.slice(1).join(' ') || undefined,
          source: 'instagram',
          // Стан "Лід" більше не використовуємо: стартуємо з "Розмова"
          state: 'message' as const,
          firstContactDate: now,
          statusId: defaultStatus?.id || 'new',
          masterId,
          masterManuallySet: false, // Автоматичне призначення
          visitedSalon: false,
          signedUpForPaidService: false,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        };
        console.log('[manychat] Created new Direct client:', { id: client.id, username: client.instagramUsername, masterId });
      } else {
        // Оновлюємо існуючого клієнта
        const safeFullName =
          typeof message.fullName === 'string' && !isTemplateOrPlaceholderName(message.fullName)
            ? message.fullName.trim()
            : null;
        const fullNameParts = safeFullName ? safeFullName.split(/\s+/) : [];
        
        // Перевіряємо, чи потрібно встановити стан 'message'
        // Стан 'message' встановлюється тільки якщо минуло більше 24 годин з останнього встановлення
        let newState = client.state;
        try {
          const { getStateHistory } = await import('@/lib/direct-state-log');
          const history = await getStateHistory(client.id);
          
          // Знаходимо останній раз коли встановлювався стан 'message'
          const lastMessageState = history
            .filter(log => log.state === 'message')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          
          const now = new Date();
          const shouldSetMessageState = !lastMessageState || 
            (now.getTime() - new Date(lastMessageState.createdAt).getTime()) >= 24 * 60 * 60 * 1000; // 24 години в мілісекундах
          
        // Якщо state відсутній (undefined) — це також "ранній" клієнт, якому треба показати "Розмова".
        if (shouldSetMessageState && (!client.state || client.state === 'client')) {
            newState = 'message';
            console.log(`[manychat] Setting state to 'message' for client ${client.id} (last message state was ${lastMessageState ? new Date(lastMessageState.createdAt).toISOString() : 'never'})`);
          }
        } catch (stateErr) {
          console.warn('[manychat] Failed to check message state history:', stateErr);
          // Продовжуємо з поточним станом
        }
        
        client = {
          ...client,
          id: client.id,
          instagramUsername: normalizedInstagram,
          ...(safeFullName && fullNameParts.length > 0 && {
            firstName: fullNameParts[0],
            lastName: fullNameParts.slice(1).join(' ') || undefined,
          }),
          state: newState,
          lastMessageAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        console.log('[manychat] Updated existing Direct client:', { id: client.id, username: client.instagramUsername, state: client.state });
      }
      
      if (client.id && client.instagramUsername) {
        await saveDirectClient(client, 'manychat-webhook', {
          messageId: message.id,
          fullName: message.fullName,
        });
        console.log('[manychat] ✅ Successfully synced Direct client:', {
          id: client.id,
          username: client.instagramUsername,
          statusId: client.statusId,
        });

        // Зберігаємо вхідне повідомлення в базу даних (історія переписки)
        const messageText = (message.text && message.text.trim()) || '(медіа або порожнє повідомлення)';
        try {
          const { PrismaClient } = await import('@prisma/client');
          const prisma = new PrismaClient();
          
          await prisma.directMessage.create({
            data: {
              clientId: client.id,
              direction: 'incoming',
              text: messageText,
              messageId: message.id?.toString(),
              source: 'manychat',
              receivedAt: new Date(message.receivedAt || Date.now()),
              rawData: rawBodyText ? rawBodyText.substring(0, 10000) : null, // Обмежуємо розмір
            },
          });
          console.log('[manychat] ✅ Incoming message saved to database');
          
          await prisma.$disconnect();
        } catch (dbErr) {
          console.error('[manychat] Failed to save incoming message to DB:', dbErr);
          // Не зупиняємо виконання webhook, просто логуємо помилку
        }
      } else {
        console.error('[manychat] ❌ Invalid client data:', { id: client.id, username: client.instagramUsername });
      }
      }
    } catch (err) {
      console.error('[manychat] ❌ Error syncing with Direct:', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        handle: message.handle,
      });
    }
  } else {
    console.warn('[manychat] ⚠️ Skipping Direct sync - no Instagram handle found');
  }

  let automation: ManychatRoutingSuccess | ManychatRoutingError;

  console.log('[manychat] Step 4: Starting automation routing');
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

      const identityCandidates = [
        { kind: 'webhook_handle', value: message.handle ?? null },
        { kind: 'webhook_fullName', value: message.fullName ?? null },
        { kind: 'payload_username', value: pickFirstString(payloadRecord.username, payloadRecord.handle) },
        { kind: 'message_username', value: pickFirstString(nestedMessage?.username, nestedMessage?.handle) },
        { kind: 'subscriber_username', value: pickFirstString(nestedSubscriber?.username) },
        { kind: 'user_username', value: pickFirstString(nestedUser?.username) },
      ];

      console.log('[manychat] Step 4: Calling routeManychatMessage');
      automation = await routeManychatMessage({
        normalized,
        identityCandidates,
        performMove: async ({
          cardId,
          pipelineId,
          statusId,
          pipelineStatusId,
          statusAliases,
        }) => {
          const normalisedCardId = toTrimmedString(cardId);
          if (!normalisedCardId) {
            return {
              ok: false,
              status: 0,
              skippedReason: 'card_id_missing',
              response: { error: 'card_id missing' },
            };
          }

          const normaliseIdInput = (value: unknown): string | null => toTrimmedString(value);
          const aliasList = Array.isArray(statusAliases)
            ? statusAliases
                .map((alias) => normaliseIdInput(alias))
                .filter((alias): alias is string => Boolean(alias))
            : [];

          try {
            // Викликаємо moveKeycrmCard напряму - той самий код, що працює в /api/keycrm/card/move
            const move = await moveKeycrmCard({
              cardId: normalisedCardId,
              pipelineId: normaliseIdInput(pipelineId),
              statusId: normaliseIdInput(statusId),
              pipelineStatusId: normaliseIdInput(pipelineStatusId),
              statusAliases: aliasList,
            });

            return {
              ok: move.ok,
              status: move.status,
              response: move.response,
              sent: move.sent,
              attempts: move.attempts,
              requestUrl: move.requestUrl,
              requestMethod: move.requestMethod,
              baseUrl: move.baseUrl ?? null,
            };
          } catch (error) {
            const err = error as { code?: string; message?: string } | Error;
            const code = typeof (err as any)?.code === 'string' ? (err as any).code : undefined;
            const message = err instanceof Error ? err.message : String(err);

            return {
              ok: false,
              status: 0,
              response: { error: message, code },
              skippedReason: code === 'keycrm_not_configured' ? 'keycrm_not_configured' : undefined,
            };
          }
        },
      });
      console.log('[manychat] Step 4: Automation routing completed:', { ok: automation?.ok });
  } catch (err) {
    console.error('[manychat] Step 4: Automation routing failed:', err);
    automation = {
      ok: false,
      error: 'automation_exception',
      details: err instanceof Error ? { message: err.message } : { message: String(err) },
    };
  }

  // Інкрементуємо лічильники після успішного переміщення
  console.log('[manychat] NEW CODE: Checking if should update counters:', {
    automationOk: automation?.ok,
    moveAttempted: automation?.ok ? (automation as ManychatRoutingSuccess).move?.attempted : undefined,
    moveOk: automation?.ok ? (automation as ManychatRoutingSuccess).move?.ok : undefined,
  });
  
  if (automation?.ok && (automation as ManychatRoutingSuccess).move?.attempted && (automation as ManychatRoutingSuccess).move.ok) {
    const campaignId = automation.match?.campaign?.id;
    const route = automation.match?.route;
    
    console.log('[manychat] NEW CODE: Inside counter update block:', { campaignId, route });
    
    if (campaignId && (route === 'v1' || route === 'v2')) {
      try {
        const field = route === 'v1' ? 'v1_count' : 'v2_count';
        
        // Перевіряємо всі можливі ключі в правильному порядку пріоритету
        // (спочатку ITEM_KEY, потім CMP_ITEM_KEY, потім LEGACY_ITEM_KEY)
        // Але завжди зберігаємо під основним ключем ITEM_KEY
        const possibleKeys = [
          campaignKeys.ITEM_KEY(campaignId),      // Основний ключ - перевіряємо першим
          campaignKeys.CMP_ITEM_KEY(campaignId),  // Старий формат
          campaignKeys.LEGACY_ITEM_KEY(campaignId), // Дуже старий формат
        ];
        
        let raw: string | null = null;
        
        // Шукаємо кампанію під будь-яким ключем
        for (const key of possibleKeys) {
          const candidateRaw = await kvRead.getRaw(key);
          if (candidateRaw) {
            const candidate = normalizeCampaignShape(candidateRaw);
            if (candidate && (candidate.id === campaignId || String(candidate.id) === campaignId)) {
              raw = candidateRaw;
              break;
            }
          }
        }
        
        // Завжди зберігаємо під основним ключем ITEM_KEY
        const itemKey = campaignKeys.ITEM_KEY(campaignId);
        
        console.log('[manychat] Updating counter:', { campaignId, route, field, itemKey, foundRaw: !!raw });
        
        if (!raw) {
          console.warn('[manychat] Campaign not found in KV:', { campaignId, possibleKeys });
          console.log('[manychat] EXITING: No raw data found, cannot update counters');
        } else {
          console.log('[manychat] Campaign found in KV, proceeding with counter update');
          console.log('[manychat] Raw data type:', typeof raw, 'length:', typeof raw === 'string' ? raw.length : 'N/A');
          // Розпаршуємо JSON якщо це рядок
          let campaign: any;
          if (typeof raw === 'string') {
            try {
              campaign = JSON.parse(raw);
            } catch (err) {
              console.error('[manychat] Failed to parse campaign JSON:', err);
              campaign = null;
            }
          } else {
            campaign = raw;
            console.log('[manychat] Raw data is not a string, using as-is:', typeof campaign);
          }
          
          console.log('[manychat] After parsing, campaign type:', typeof campaign, 'isObject:', campaign && typeof campaign === 'object');
          
          // Перевіряємо чи це об'єкт
          if (campaign && typeof campaign === 'object') {
            console.log('[manychat] Campaign is an object, proceeding with counter update');
            
            // Нормалізуємо структуру counters якщо немає
            if (!campaign.counters) {
              campaign.counters = {
                v1: campaign.v1_count || 0,
                v2: campaign.v2_count || 0,
                exp: campaign.exp_count || 0,
              };
            }
            
            // Інкрементуємо відповідний лічильник
            const oldValue = typeof campaign[field] === 'number' ? campaign[field] : 0;
            campaign[field] = oldValue + 1;
            
            console.log('[manychat] Counter incremented:', { field, oldValue, newValue: campaign[field] });
            
            // Оновлюємо counters
            if (route === 'v1') {
              campaign.counters.v1 = campaign.v1_count;
            } else if (route === 'v2') {
              campaign.counters.v2 = campaign.v2_count;
            }
            
            // Оновлюємо movedTotal, movedV1, movedV2, movedExp
            const v1Count = campaign.counters.v1 || campaign.v1_count || 0;
            const v2Count = campaign.counters.v2 || campaign.v2_count || 0;
            const expCount = campaign.counters.exp || campaign.exp_count || 0;
            
            campaign.movedTotal = v1Count + v2Count + expCount;
            campaign.movedV1 = v1Count;
            campaign.movedV2 = v2Count;
            campaign.movedExp = expCount;
            
            console.log('[manychat] Counters calculated:', { v1Count, v2Count, expCount, movedTotal: campaign.movedTotal });
            
            console.log(`[manychat] Before saving: campaign object prepared`, {
              campaignId,
              itemKey,
              v1_count: campaign.v1_count,
              movedV1: campaign.movedV1,
              movedTotal: campaign.movedTotal,
              campaignType: typeof campaign,
              isObject: campaign && typeof campaign === 'object',
            });
            
            try {
              // Зберігаємо назад в KV під усіма можливими ключами для сумісності
              const serialized = JSON.stringify(campaign);
              
              console.log(`[manychat] Serialized campaign:`, {
                campaignId,
                itemKey,
                serializedLength: serialized.length,
                serializedPreview: serialized.slice(0, 200),
              });
              
              // Зберігаємо під основним ключем (ITEM_KEY)
              console.log(`[manychat] Saving to ITEM_KEY: ${itemKey}`, {
                campaignId,
                v1_count: campaign.v1_count,
                movedV1: campaign.movedV1,
                movedTotal: campaign.movedTotal,
              });
              
              await kvWrite.setRaw(itemKey, serialized);
              console.log(`[manychat] Successfully saved to ITEM_KEY: ${itemKey}`);
              
              // Перевіряємо, чи дані збереглися правильно
              const verifyRaw = await kvRead.getRaw(itemKey);
              if (verifyRaw) {
                const verify = normalizeCampaignShape(verifyRaw);
                console.log(`[manychat] Verified ITEM_KEY after save: ${itemKey}`, {
                  campaignId,
                  found: !!verify,
                  v1_count: verify?.v1_count,
                  movedV1: verify?.movedV1,
                  movedTotal: verify?.movedTotal,
                });
              } else {
                console.error(`[manychat] Failed to verify ITEM_KEY after save: ${itemKey}`);
              }
              
              // Також зберігаємо під CMP_ITEM_KEY для сумісності з listCampaigns
              const cmpItemKey = campaignKeys.CMP_ITEM_KEY(campaignId);
              try {
                await kvWrite.setRaw(cmpItemKey, serialized);
                console.log(`[manychat] Successfully saved to CMP_ITEM_KEY: ${cmpItemKey}`);
              } catch (err) {
                console.warn('[manychat] Failed to save to CMP_ITEM_KEY:', err);
              }
              
              // Також зберігаємо під LEGACY_ITEM_KEY для повної сумісності
              const legacyItemKey = campaignKeys.LEGACY_ITEM_KEY(campaignId);
              try {
                await kvWrite.setRaw(legacyItemKey, serialized);
                console.log(`[manychat] Successfully saved to LEGACY_ITEM_KEY: ${legacyItemKey}`);
              } catch (err) {
                console.warn('[manychat] Failed to save to LEGACY_ITEM_KEY:', err);
              }
              
              console.log('[manychat] Counter updated successfully:', {
                campaignId,
                route,
                field,
                oldValue,
                newValue: campaign[field],
                movedTotal: campaign.movedTotal,
                movedV1: campaign.movedV1,
                movedV2: campaign.movedV2,
                savedToKeys: [itemKey, cmpItemKey, legacyItemKey],
              });
            } catch (saveError) {
              console.error('[manychat] Error during save operation:', {
                campaignId,
                itemKey,
                error: saveError instanceof Error ? saveError.message : String(saveError),
                stack: saveError instanceof Error ? saveError.stack : undefined,
              });
              // Не перериваємо виконання, але логуємо помилку
            }
            
            // Оновлюємо індекс
            try {
              await kvWrite.lpush(campaignKeys.INDEX_KEY, campaignId);
            } catch (err) {
              // Ігноруємо помилки індексу
            }
            
            // Оновлюємо кількість карток в базовій воронці
            try {
              const { updateCampaignBaseCardsCount } = await import('@/lib/campaign-stats');
              await updateCampaignBaseCardsCount(campaignId);
            } catch (err) {
              console.warn('[manychat] Failed to update base cards count:', err);
            }
            
            // Зберігаємо timestamp для EXP tracking (тільки якщо кампанія має EXP)
            const hasExp = Boolean(
              campaign.expDays || 
              campaign.expireDays || 
              campaign.exp || 
              campaign.vexp || 
              campaign.expire ||
              campaign.texp
            );
            
            if (hasExp && (automation as ManychatRoutingSuccess).search?.selected?.match?.cardId) {
              try {
                const cardId = String((automation as ManychatRoutingSuccess).search.selected.match.cardId);
                const basePipelineId = (automation as ManychatRoutingSuccess).match?.campaign?.base?.pipelineId 
                  ? Number((automation as ManychatRoutingSuccess).match.campaign.base.pipelineId) 
                  : null;
                const baseStatusId = (automation as ManychatRoutingSuccess).match?.campaign?.base?.statusId
                  ? Number((automation as ManychatRoutingSuccess).match.campaign.base.statusId)
                  : null;
                
                const { saveExpTracking } = await import('@/lib/exp-tracking');
                await saveExpTracking(campaignId, cardId, basePipelineId, baseStatusId);
              } catch (err) {
                console.warn('[manychat] Failed to save EXP tracking:', err);
              }
            }
          } else {
            console.error('[manychat] Campaign is not an object:', { campaignId, itemKey, campaignType: typeof campaign });
          }
        }
      } catch (err) {
        console.error('[manychat] Error updating counter:', {
          campaignId,
          route,
          error: err instanceof Error ? err.message : String(err),
        });
        // Не перериваємо виконання - просто логуємо помилку
      }
    }
  }

  if (automation) {
    try {
      await persistManychatAutomation(automation);
    } catch (err) {
      console.error('[manychat] Не вдалося зберегти автоматизацію у KV:', err);
    }
  }

  lastAutomation = automation;

  console.log('[manychat] Returning response:', {
    ok: true,
    automationOk: automation?.ok,
    moveAttempted: automation?.ok ? (automation as ManychatRoutingSuccess).move?.attempted : undefined,
    moveOk: automation?.ok ? (automation as ManychatRoutingSuccess).move?.ok : undefined,
  });

  return NextResponse.json({ ok: true, message, automation });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    
    // Логуємо помилку
    console.error('[manychat] Fatal error in POST handler:', {
      error: errorMsg,
      name: errorName,
      stack: errorStack,
    });
    
    // Повертаємо детальну помилку в response, щоб бачити в логах
    return NextResponse.json(
      { 
        ok: false, 
        error: 'internal_error',
        errorName,
        message: errorMsg,
        stack: errorStack ? errorStack.split('\n').slice(0, 10).join('\n') : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // Якщо запитують лог вебхуків (підтримуємо обидва варіанти: webhooks=true та check=webhooks)
  const webhooksParam = req.nextUrl.searchParams.get('webhooks');
  const checkParam = req.nextUrl.searchParams.get('check');
  const showWebhooks = webhooksParam === 'true' || checkParam === 'webhooks';
  
  // Додаткова перевірка для debug
  const url = req.nextUrl.toString();
  const hasWebhookParam = url.includes('webhooks=true') || url.includes('check=webhooks');
  
  console.log('[manychat] GET request:', { 
    webhooksParam, 
    checkParam, 
    showWebhooks, 
    hasWebhookParam,
    url: url.substring(0, 200) 
  });
  
  if (showWebhooks || hasWebhookParam) {
    console.log('[manychat] Returning webhook log');
    try {
      const limitParam = req.nextUrl.searchParams.get('limit');
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;

      console.log('[manychat] Reading webhook log from KV, limit:', limit);
      const rawItems = await kvRead.lrange('manychat:webhook:log', 0, limit - 1);
      console.log('[manychat] Raw items from KV:', rawItems.length);
      const webhooks = rawItems
        .map((raw, index) => {
          try {
            let parsed: unknown = raw;
            
            // Vercel KV може повертати дані в різних форматах
            if (typeof raw === 'string') {
              try {
                parsed = JSON.parse(raw);
              } catch {
                // Якщо не JSON, повертаємо як є
                return { raw, error: 'Not valid JSON string' };
              }
            } else if (raw && typeof raw === 'object') {
              // Може бути об'єкт з полем value (Vercel KV формат)
              const rawObj = raw as Record<string, unknown>;
              if ('value' in rawObj && typeof rawObj.value === 'string') {
                try {
                  // Парсимо JSON рядок з поля value
                  const parsedValue = JSON.parse(rawObj.value);
                  parsed = parsedValue;
                } catch (parseError) {
                  // Якщо не вдалося розпарсити, спробуємо використати як є
                  parsed = rawObj.value;
                }
              } else {
                // Якщо немає поля value, використовуємо raw як є
                parsed = raw;
              }
            }
            
            // Перевіряємо, чи це валідний об'єкт вебхука
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const parsedObj = parsed as Record<string, unknown>;
              const parsedKeys = Object.keys(parsedObj);
              
              // Перевіряємо, чи є поле receivedAt (може бути string або Date)
              if ('receivedAt' in parsedObj) {
                // Перевіряємо тип receivedAt
                const hasValidReceivedAt = 
                  typeof parsedObj.receivedAt === 'string' || 
                  parsedObj.receivedAt instanceof Date ||
                  typeof parsedObj.receivedAt === 'number';
                
                if (hasValidReceivedAt) {
                  return parsedObj;
                }
              }
              
              // Якщо parsed має тільки поле "value", спробуємо розпарсити його
              if (parsedKeys.length === 1 && parsedKeys[0] === 'value' && typeof parsedObj.value === 'string') {
                try {
                  const doubleParsed = JSON.parse(parsedObj.value);
                  if (doubleParsed && typeof doubleParsed === 'object' && !Array.isArray(doubleParsed)) {
                    const doubleParsedObj = doubleParsed as Record<string, unknown>;
                    if ('receivedAt' in doubleParsedObj) {
                      return doubleParsedObj;
                    }
                  }
                } catch {
                  // Ігноруємо помилку парсингу
                }
              }
            }
            
            // Якщо не пройшов перевірку, повертаємо помилку з деталями для діагностики
            const parsedType = parsed ? typeof parsed : 'null';
            const isArray = Array.isArray(parsed);
            const hasReceivedAt = parsed && typeof parsed === 'object' && !Array.isArray(parsed) 
              ? 'receivedAt' in (parsed as Record<string, unknown>)
              : false;
            
            return { 
              raw: parsed, 
              index, 
              error: 'Invalid webhook format',
              debug: {
                parsedType,
                isArray,
                hasReceivedAt,
                keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                  ? Object.keys(parsed as Record<string, unknown>)
                  : []
              }
            };
          } catch (err) {
            return { 
              raw, 
              index, 
              error: err instanceof Error ? err.message : 'Failed to parse' 
            };
          }
        })
        .filter(Boolean);

      // Розділяємо валідні вебхуки та помилки
      const validWebhooks = webhooks.filter((w: any) => !w.error);
      const errors = webhooks.filter((w: any) => w.error);

      console.log('[manychat] Webhook log processed:', {
        totalItems: rawItems.length,
        validWebhooks: validWebhooks.length,
        errors: errors.length,
      });

      return NextResponse.json({
        ok: true,
        message: 'ManyChat webhook log',
        timestamp: new Date().toISOString(),
        totalItems: rawItems.length,
        webhooksCount: validWebhooks.length,
        errorsCount: errors.length,
        webhooks: validWebhooks,
        ...(errors.length > 0 && { parsingErrors: errors }),
      });
    } catch (error) {
      console.error('[manychat] Error reading webhook log:', error);
      return NextResponse.json(
        {
          ok: false,
          message: 'Failed to read webhook log',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        { status: 500 },
      );
    }
  }
  
  console.log('[manychat] Returning standard response (not webhook log)');

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
  let automationAnalysis: ManychatRoutingSuccess | ManychatRoutingError | null = null;

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

  const hasAnalysisInput =
    normalizedReplay.text.trim().length > 0 || normalizedReplay.handle !== null || normalizedReplay.fullName !== null;

  if (hasAnalysisInput) {
    try {
      automationAnalysis = await routeManychatMessage({
        normalized: normalizedReplay,
        identityCandidates,
      });
    } catch (error) {
      automationAnalysis = {
        ok: false,
        error: 'analysis_failed',
        details: error instanceof Error ? { message: error.message } : { message: String(error) },
      };
    }
  }

  if (!automation) {
    try {
      const replayResult = await routeManychatMessage({
        normalized: normalizedReplay,
        identityCandidates,
        performMove: async ({
          cardId,
          pipelineId,
          statusId,
          pipelineStatusId,
          statusAliases,
        }) => {
          const normalisedCardId = toTrimmedString(cardId);
          if (!normalisedCardId) {
            return {
              ok: false,
              status: 0,
              skippedReason: 'card_id_missing',
              response: { error: 'card_id missing' },
            };
          }

          const normaliseIdInput = (value: unknown): string | null => toTrimmedString(value);
          const aliasList = Array.isArray(statusAliases)
            ? statusAliases
                .map((alias) => normaliseIdInput(alias))
                .filter((alias): alias is string => Boolean(alias))
            : [];

          try {
            // Викликаємо moveKeycrmCard напряму - той самий код, що працює в /api/keycrm/card/move
            const move = await moveKeycrmCard({
              cardId: normalisedCardId,
              pipelineId: normaliseIdInput(pipelineId),
              statusId: normaliseIdInput(statusId),
              pipelineStatusId: normaliseIdInput(pipelineStatusId),
              statusAliases: aliasList,
            });

            return {
              ok: move.ok,
              status: move.status,
              response: move.response,
              sent: move.sent,
              attempts: move.attempts,
              requestUrl: move.requestUrl,
              requestMethod: move.requestMethod,
              baseUrl: move.baseUrl ?? null,
            };
          } catch (error) {
            const err = error as { code?: string; message?: string } | Error;
            const code = typeof (err as any)?.code === 'string' ? (err as any).code : undefined;
            const message = err instanceof Error ? err.message : String(err);

            return {
              ok: false,
              status: 0,
              response: { error: message, code },
              skippedReason: code === 'keycrm_not_configured' ? 'keycrm_not_configured' : undefined,
            };
          }
        },
      });

      automation = replayResult;
      automationSource = automationSource ?? 'memory';
      automationReceivedAt = Date.now();
      lastAutomation = automation;

      automationReplay = {
        used: true,
        reason: 'Автоматизацію виконано повторно під час GET, оскільки результат не знайдено у KV.',
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

  // Debug інформація для перевірки параметрів
  const debugInfo = {
    webhooksParam: req.nextUrl.searchParams.get('webhooks'),
    checkParam: req.nextUrl.searchParams.get('check'),
    showWebhooks: webhooksParam === 'true' || checkParam === 'webhooks',
    url: req.nextUrl.toString().substring(0, 200),
  };

  return NextResponse.json({
    ok: true,
    latest: latest ?? null,
    feed,
    messages: feed,
    source,
    trace,
    diagnostics,
    automation: automation ?? null,
    automationAnalysis: automationAnalysis ?? null,
    _debug: debugInfo, // Debug інформація (видалити після тестування)
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
