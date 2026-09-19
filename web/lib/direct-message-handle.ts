// web/lib/direct-message-handle.ts
// Витяг Instagram handle з rawData повідомлення ManyChat

import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { normalizeInstagram } from './normalize';

function isRecoverableInstagramHandle(normalized: string): boolean {
  return (
    Boolean(normalized) &&
    !normalized.startsWith('missing_instagram_') &&
    !normalized.startsWith('no_instagram_') &&
    !normalized.startsWith('__no_ig__') &&
    !normalized.startsWith('altegio_') &&
    !normalized.startsWith('binotel_')
  );
}

/** Instagram username з JSON/raw webhook повідомлення (узгоджено з recover-instagram-from-messages). */
export function extractInstagramHandleFromMessageRawData(rawData: string | null): string | null {
  if (!rawData || typeof rawData !== 'string') return null;
  const s = rawData.trim();
  if (!s) return null;

  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      const handle =
        (parsed as Record<string, unknown>).handle ||
        (parsed as Record<string, unknown>).username ||
        (parsed as Record<string, unknown>).user_name ||
        (parsed as Record<string, unknown>).instagram_username ||
        (parsed as { subscriber?: { username?: unknown } }).subscriber?.username ||
        (parsed as { user?: { username?: unknown } }).user?.username ||
        (parsed as { sender?: { username?: unknown } }).sender?.username ||
        (parsed as { message?: { username?: unknown; handle?: unknown } }).message?.username ||
        (parsed as { message?: { username?: unknown; handle?: unknown } }).message?.handle ||
        null;
      if (handle && typeof handle === 'string') {
        const normalized = normalizeInstagram(handle);
        if (normalized && isRecoverableInstagramHandle(normalized)) {
          return normalized;
        }
      }
    }
  } catch {
    // Не JSON — regex нижче
  }

  const patterns = [
    /"handle"\s*:\s*"([^"]+)"/,
    /"username"\s*:\s*"([^"]+)"/,
    /"user_name"\s*:\s*"([^"]+)"/,
    /"instagram_username"\s*:\s*"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const normalized = normalizeInstagram(m[1]);
      if (normalized && isRecoverableInstagramHandle(normalized)) {
        return normalized;
      }
    }
  }
  return null;
}

/** URL аватарки з rawData повідомлення ManyChat. */
export function extractAvatarUrlFromMessageRawData(rawData: string | null): string | null {
  if (!rawData || typeof rawData !== 'string') return null;
  const s = rawData.trim();
  if (!s) return null;

  const pickFromObj = (obj: Record<string, unknown>): string | null => {
    const keys = [
      'profile_pic',
      'profile_picture',
      'profile_pic_url',
      'profile_picture_url',
      'avatar',
      'avatar_url',
      'picture',
      'picture_url',
      'photo',
      'photo_url',
      'ig_profile_pic',
    ];
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
    }
    for (const nestKey of ['subscriber', 'user', 'sender', 'data', 'message']) {
      const nest = obj[nestKey];
      if (nest && typeof nest === 'object') {
        const found = pickFromObj(nest as Record<string, unknown>);
        if (found) return found;
      }
    }
    return null;
  };

  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      const found = pickFromObj(parsed as Record<string, unknown>);
      if (found) return found;
    }
  } catch {
    // regex
  }

  const patterns = [
    /"profile_pic"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"profile_picture"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"profile_pic_url"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"avatar_url"\s*:\s*"(https?:\/\/[^"]+)"/i,
    /"avatar"\s*:\s*"(https?:\/\/[^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Для UI: реальний нік з картки або з переписки (не placeholder). */
export function resolveDisplayInstagramUsername(
  storedUsername?: string | null,
  fromMessages?: string | null
): string {
  const stored = (storedUsername || '').trim();
  if (hasNormalInstagramUsername(stored)) return stored;
  const fromMsg = (fromMessages || '').trim();
  if (hasNormalInstagramUsername(fromMsg)) return fromMsg;
  return stored;
}
