// web/lib/direct-instagram-avatar-warm.ts
// Прогрів KV-аватарки після ручного збереження IG / recover.

import { kvRead, kvWrite } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { getEnvValue } from '@/lib/env';
import { getSubscriberIdFromClientMessages } from '@/lib/direct-store';

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
const directAvatarByClientKey = (clientId: string) => `direct:ig-avatar-client:${clientId}`;
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

function pickAvatar(node: any): string | null {
  const candidates = [
    node?.profile_pic,
    node?.profile_picture,
    node?.profile_pic_url,
    node?.profile_picture_url,
    node?.avatar,
    node?.avatar_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c.trim())) return c.trim();
  }
  return null;
}

function pickIg(item: any): string | null {
  const c = item?.ig_username || item?.instagram_username || item?.username || null;
  if (typeof c !== 'string') return null;
  const n = normalizeInstagram(c);
  return n && hasNormalInstagramUsername(n) ? n : null;
}

/** Скидає miss-cache і тягне profile_pic у KV (username + clientId). */
export async function warmInstagramAvatarCache(opts: {
  username: string;
  clientId?: string | null;
}): Promise<{ ok: boolean; avatarUrl?: string; reason?: string }> {
  const normalized = normalizeInstagram(opts.username) || String(opts.username || '').trim().toLowerCase();
  if (!normalized || !hasNormalInstagramUsername(normalized)) {
    return { ok: false, reason: 'invalid_username' };
  }
  const clientId = (opts.clientId || '').trim() || null;

  // Скидаємо miss-cache (старий ключ без username + новий з username)
  const missKeys = [
    `direct:ig-avatar-miss:${normalized}`,
    ...(clientId
      ? [
          `direct:ig-avatar-miss-client:${clientId}`,
          `direct:ig-avatar-miss-client:${clientId}:${normalized}`,
          `direct:ig-avatar-miss-client:${clientId}:_`,
        ]
      : []),
  ];
  for (const k of missKeys) {
    try {
      await kvWrite.setRaw(k, '');
    } catch {
      // ignore
    }
  }

  // Вже є в KV?
  try {
    const existing = await kvRead.getRaw(directAvatarKey(normalized));
    if (typeof existing === 'string' && /^https?:\/\//i.test(existing.trim())) {
      if (clientId) {
        try {
          await kvWrite.setRaw(directAvatarByClientKey(clientId), existing.trim());
        } catch {
          // ignore
        }
      }
      return { ok: true, avatarUrl: existing.trim(), reason: 'kv_hit' };
    }
  } catch {
    // continue
  }

  const apiKey = getManyChatApiKey();
  if (!apiKey) return { ok: false, reason: 'no_api_key' };

  let avatarUrl: string | null = null;
  let subscriberId: string | null = null;

  // 1) subscriber з повідомлень клієнта
  if (clientId) {
    subscriberId = await getSubscriberIdFromClientMessages(clientId);
  }
  if (!subscriberId) {
    try {
      const raw = await kvRead.getRaw(directSubscriberKey(normalized));
      if (typeof raw === 'string' && raw.trim()) {
        const m = raw.match(/\d+/);
        subscriberId = m?.[0] || raw.trim();
      }
    } catch {
      // ignore
    }
  }

  // 2) findByName по точному IG
  if (!avatarUrl) {
    try {
      const findUrl = `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(normalized)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(findUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        const arr = Array.isArray(data?.data) ? data.data : [];
        const match = arr.find((item: any) => pickIg(item) === normalized) || (arr.length === 1 ? arr[0] : null);
        if (match) {
          avatarUrl = pickAvatar(match);
          const sid = match?.subscriber_id || match?.id;
          if (sid != null) subscriberId = String(sid).match(/\d+/)?.[0] || String(sid);
        }
      }
    } catch (err) {
      console.warn('[warm-avatar] findByName:', err);
    }
  }

  // 3) getInfo
  if (!avatarUrl && subscriberId) {
    try {
      const infoUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(infoUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        avatarUrl = pickAvatar(data?.data ?? data);
      }
    } catch (err) {
      console.warn('[warm-avatar] getInfo:', err);
    }
  }

  if (!avatarUrl) {
    console.warn('[warm-avatar] не знайшов profile_pic', { username: normalized, clientId, subscriberId });
    return { ok: false, reason: 'not_found', ...(subscriberId ? { subscriberId } as any : {}) };
  }

  try {
    await kvWrite.setRaw(directAvatarKey(normalized), avatarUrl);
    if (clientId) await kvWrite.setRaw(directAvatarByClientKey(clientId), avatarUrl);
    if (subscriberId) await kvWrite.setRaw(directSubscriberKey(normalized), subscriberId);
  } catch (err) {
    console.warn('[warm-avatar] kv write:', err);
  }

  console.log('[warm-avatar] ✅', { username: normalized, clientId });
  return { ok: true, avatarUrl };
}
