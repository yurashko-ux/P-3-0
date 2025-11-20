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
  console.log('[manychat] POST request received');
  
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
      const result = await readRequestPayload(req);
      payload = result.parsed;
      rawText = result.rawText;
      console.log('[manychat] Step 2: Request payload read successfully');
    } catch (err) {
      console.error('[manychat] Step 2: Failed to read request payload:', err);
      throw err;
    }

    console.log('[manychat] Step 3: Normalizing payload');
    let message: ReturnType<typeof normalisePayload>;
    try {
      message = normalisePayload(payload, rawText);
      console.log('[manychat] Step 3: Payload normalized successfully');
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
        } else {
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
          }
          
          // Перевіряємо чи це об'єкт
          if (campaign && typeof campaign === 'object') {
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
            
            // Зберігаємо назад в KV під усіма можливими ключами для сумісності
            const serialized = JSON.stringify(campaign);
            
            // Зберігаємо під основним ключем (ITEM_KEY)
            console.log(`[manychat] Saving to ITEM_KEY: ${itemKey}`, {
              campaignId,
              v1_count: campaign.v1_count,
              movedV1: campaign.movedV1,
              movedTotal: campaign.movedTotal,
            });
            await kvWrite.setRaw(itemKey, serialized);
            
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
            } catch (err) {
              console.warn('[manychat] Failed to save to CMP_ITEM_KEY:', err);
            }
            
            // Також зберігаємо під LEGACY_ITEM_KEY для повної сумісності
            const legacyItemKey = campaignKeys.LEGACY_ITEM_KEY(campaignId);
            try {
              await kvWrite.setRaw(legacyItemKey, serialized);
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
