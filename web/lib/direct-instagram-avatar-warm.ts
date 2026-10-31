// web/lib/direct-instagram-avatar-warm.ts
// Прогрів KV-аватарки через Instagram Graph (без ManyChat).

import { kvRead, kvWrite } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
const directAvatarByClientKey = (clientId: string) => `direct:ig-avatar-client:${clientId}`;

/** Скидає miss-cache і тягне profile_pic у KV через Instagram Graph. */
export async function warmInstagramAvatarCache(opts: {
  username: string;
  clientId?: string | null;
  igsid?: string | null;
}): Promise<{ ok: boolean; avatarUrl?: string; reason?: string }> {
  const normalized = normalizeInstagram(opts.username) || String(opts.username || '').trim().toLowerCase();
  if (!normalized || !hasNormalInstagramUsername(normalized)) {
    return { ok: false, reason: 'invalid_username' };
  }
  const clientId = (opts.clientId || '').trim() || null;

  const missKeys = [
    `direct:ig-avatar-miss:${normalized}`,
    `direct:ig-avatar-miss-v2:${normalized}`,
    `direct:ig-avatar-miss-v3:${normalized}`,
    ...(clientId
      ? [
          `direct:ig-avatar-miss-client:${clientId}`,
          `direct:ig-avatar-miss-client:${clientId}:${normalized}`,
          `direct:ig-avatar-miss-client:${clientId}:_`,
          `direct:ig-avatar-miss-client-v2:${clientId}:${normalized}`,
          `direct:ig-avatar-miss-client-v2:${clientId}:_`,
          `direct:ig-avatar-miss-client-v3:${clientId}:${normalized}`,
          `direct:ig-avatar-miss-client-v3:${clientId}:_`,
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

  if (!clientId) {
    return { ok: false, reason: 'no_client_id' };
  }

  try {
    const { resolveInstagramGraphAvatar } = await import('@/lib/direct-instagram-graph-avatar');
    const graph = await resolveInstagramGraphAvatar({
      clientId,
      username: normalized,
      igsid: opts.igsid || null,
    });
    if (graph.ok && graph.avatarUrl) {
      console.log('[warm-avatar] ✅ Graph', { username: normalized, clientId });
      return { ok: true, avatarUrl: graph.avatarUrl, reason: graph.reason || 'graph' };
    }
    console.warn('[warm-avatar] Graph не знайшов profile_pic', {
      username: normalized,
      clientId,
      reason: graph.reason || null,
    });
    return { ok: false, reason: graph.reason || 'not_found' };
  } catch (err) {
    console.warn('[warm-avatar] Graph error:', err);
    return { ok: false, reason: 'graph_error' };
  }
}
