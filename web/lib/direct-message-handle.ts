// web/lib/direct-message-handle.ts
// Витяг Instagram handle з rawData повідомлення ManyChat

import { normalizeInstagram } from './normalize';

function isRecoverableInstagramHandle(normalized: string): boolean {
  return (
    Boolean(normalized) &&
    !normalized.startsWith('missing_instagram_') &&
    !normalized.startsWith('no_instagram_')
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
