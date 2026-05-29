// web/lib/inactive-base/telegram-business.ts
// Telegram Business connection id для розсилки від імені акаунта салону.

import { kvRead, kvWrite } from '@/lib/kv';

const KV_KEY = 'inactive-base:telegram:business_connection_id';

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

export function bigintToNumber(id: bigint | number | null | undefined): number | null {
  if (id == null) return null;
  if (typeof id === 'bigint') {
    const n = Number(id);
    return Number.isSafeInteger(n) ? n : null;
  }
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}
