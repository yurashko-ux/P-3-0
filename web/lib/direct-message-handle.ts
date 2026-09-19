// web/lib/direct-message-handle.ts
// Витяг Instagram handle з rawData повідомлення ManyChat

import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { normalizeInstagram } from './normalize';

function isRecoverableInstagramHandle(normalized: string): boolean {
  return (
    Boolean(normalized) &&
    hasNormalInstagramUsername(normalized) &&
    !normalized.startsWith('missing_instagram_') &&
    !normalized.startsWith('no_instagram_') &&
    !normalized.startsWith('__no_ig__') &&
    !normalized.startsWith('altegio_') &&
    !normalized.startsWith('binotel_')
  );
}

function tryNormalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = normalizeInstagram(raw);
  if (normalized && isRecoverableInstagramHandle(normalized)) return normalized;
  return null;
}

/**
 * Instagram username з JSON/raw webhook повідомлення.
 * ManyChat часто кладе нік у `ig_username` / `subscriber.ig_username`, не лише в `username`.
 */
export function extractInstagramHandleFromMessageRawData(rawData: string | null): string | null {
  if (!rawData || typeof rawData !== 'string') return null;
  const s = rawData.trim();
  if (!s) return null;

  const HANDLE_KEYS = new Set([
    'handle',
    'username',
    'user_name',
    'instagram_username',
    'ig_username',
    'igusername',
    'instagramusername',
  ]);

  const walk = (node: unknown, depth: number): string | null => {
    if (node == null || depth > 8) return null;
    if (typeof node === 'string') return tryNormalizeHandle(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    const obj = node as Record<string, unknown>;

    // 1) Пріоритет — явні ключі IG (ig_username раніше за загальний username)
    for (const key of [
      'ig_username',
      'instagram_username',
      'handle',
      'username',
      'user_name',
    ]) {
      if (key in obj) {
        const found = tryNormalizeHandle(obj[key]);
        if (found) return found;
      }
    }

    // 2) Вкладені subscriber / user / sender / message / data
    for (const nestKey of ['subscriber', 'user', 'sender', 'from', 'message', 'data']) {
      if (nestKey in obj) {
        const found = walk(obj[nestKey], depth + 1);
        if (found) return found;
      }
    }

    // 3) Будь-який ключ зі списку HANDLE_KEYS глибше
    for (const [k, v] of Object.entries(obj)) {
      if (HANDLE_KEYS.has(k.toLowerCase())) {
        const found = tryNormalizeHandle(v);
        if (found) return found;
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      const found = walk(parsed, 0);
      if (found) return found;
    }
  } catch {
    // regex нижче
  }

  // Form-urlencoded / обрізаний JSON
  const patterns = [
    /"ig_username"\s*:\s*"([^"]+)"/i,
    /"instagram_username"\s*:\s*"([^"]+)"/i,
    /"handle"\s*:\s*"([^"]+)"/i,
    /"username"\s*:\s*"([^"]+)"/i,
    /"user_name"\s*:\s*"([^"]+)"/i,
    /ig_username=([^&\s]+)/i,
    /instagram_username=([^&\s]+)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const found = tryNormalizeHandle(decodeURIComponent(m[1]));
      if (found) return found;
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
