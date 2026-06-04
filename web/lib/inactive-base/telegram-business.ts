// web/lib/inactive-base/telegram-business.ts
// Telegram Business connection id та user id салону для розсилки та direction.

import { kvRead, kvWrite } from '@/lib/kv';
import { getDirectRemindersBotToken } from '@/lib/direct-reminders/telegram';
import type { TelegramBusinessConnection } from '@/lib/telegram/types';

const KV_KEY = 'inactive-base:telegram:business_connection_id';
const KV_USER_KEY = 'inactive-base:telegram:business_user_id';

export async function getStoredBusinessConnectionId(): Promise<string | null> {
  const fromEnv = (process.env.TELEGRAM_BUSINESS_CONNECTION_ID || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = await kvRead.getRaw(KV_KEY);
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as { value?: string } | string;
        if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
        if (parsed && typeof parsed === 'object' && typeof parsed.value === 'string' && parsed.value.trim()) {
          return parsed.value.trim();
        }
      } catch {
        return raw.trim();
      }
    }
  } catch (err) {
    console.warn('[inactive-base/telegram-business] KV read failed:', err);
  }
  return null;
}

export async function storeBusinessConnectionId(connectionId: string): Promise<void> {
  const trimmed = connectionId.trim();
  if (!trimmed) return;
  try {
    await kvWrite.setRaw(KV_KEY, JSON.stringify(trimmed));
    console.log(`[inactive-base/telegram-business] Збережено business_connection_id (${trimmed.length} символів)`);
  } catch (err) {
    console.error('[inactive-base/telegram-business] KV write failed:', err);
  }
}

function parseKvBigIntId(raw: unknown): bigint | null {
  try {
    let v: unknown = raw;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v) as { value?: string } | string;
        if (typeof parsed === 'object' && parsed && 'value' in parsed) v = parsed.value;
        else if (typeof parsed === 'string') v = parsed;
      } catch {
        v = v.trim();
      }
    }
    const s = String(v ?? '').trim();
    if (!s || !/^\d+$/.test(s)) return null;
    return BigInt(s);
  } catch {
    return null;
  }
}

/** Telegram user id акаунта салону (власник Business), не клієнта. */
export async function getStoredBusinessUserId(): Promise<bigint | null> {
  const fromEnv = (process.env.TELEGRAM_BUSINESS_USER_ID || '').trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) return BigInt(fromEnv);
  try {
    const raw = await kvRead.getRaw(KV_USER_KEY);
    return parseKvBigIntId(raw);
  } catch (err) {
    console.warn('[inactive-base/telegram-business] KV read business_user_id failed:', err);
  }
  return null;
}

export async function storeBusinessUserId(userId: number | bigint): Promise<void> {
  const s = String(userId).trim();
  if (!s || !/^\d+$/.test(s)) return;
  try {
    await kvWrite.setRaw(KV_USER_KEY, JSON.stringify(s));
    console.log(`[inactive-base/telegram-business] Збережено business_user_id=${s}`);
  } catch (err) {
    console.error('[inactive-base/telegram-business] KV write business_user_id failed:', err);
  }
}

/** Отримати user id салону з Telegram API (getBusinessConnection), якщо ще не в KV. */
export async function ensureBusinessUserIdCached(): Promise<bigint | null> {
  const existing = await getStoredBusinessUserId();
  if (existing != null) return existing;

  const connectionId = await getStoredBusinessConnectionId();
  if (!connectionId) return null;

  let token: string;
  try {
    token = getDirectRemindersBotToken();
  } catch {
    return null;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getBusinessConnection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_connection_id: connectionId }),
    });
    const data = (await res.json()) as { ok?: boolean; result?: TelegramBusinessConnection };
    const userId = data.ok ? data.result?.user?.id : undefined;
    if (userId != null) {
      await storeBusinessUserId(userId);
      return BigInt(userId);
    }
  } catch (err) {
    console.warn('[inactive-base/telegram-business] getBusinessConnection failed:', err);
  }
  return null;
}

export function bigintToNumber(id: bigint | number | null | undefined): number | null {
  if (id == null) return null;
  if (typeof id === 'bigint') {
    const n = Number(id);
    return Number.isSafeInteger(n) ? n : null;
  }
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}
