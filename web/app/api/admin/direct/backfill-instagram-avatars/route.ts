// web/app/api/admin/direct/backfill-instagram-avatars/route.ts
// Backfill аватарок Instagram для існуючих клієнтів через ManyChat API → KV.
//
// Принцип:
// - читаємо список subscribers з ManyChat
// - витягуємо ig_username + avatar URL
// - зберігаємо в KV: direct:ig-avatar:<username>

import { NextRequest, NextResponse } from 'next/server';
import { normalizeInstagram } from '@/lib/normalize';
import { kvRead, kvWrite } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function getManyChatApiKey(): string | null {
  const key = (
    process.env.MANYCHAT_API_KEY ||
    process.env.ManyChat_API_Key ||
    process.env.MANYCHAT_API_TOKEN ||
    process.env.MC_API_KEY ||
    process.env.MANYCHAT_APIKEY ||
    null
  );
  return key ? String(key).trim() : null;
}

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;

function pickFirstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const t = value.trim();
      if (t) return t;
    }
  }
  return null;
}

function pickInstagramUsername(sub: any): string | null {
  const candidate = pickFirstString(
    sub?.ig_username,
    sub?.instagram_username,
    sub?.igUsername,
    sub?.instagramUsername,
    sub?.username,
  );
  const normalized = candidate ? normalizeInstagram(candidate) : null;
  return normalized || (candidate ? candidate.trim().toLowerCase() : null);
}

function pickAvatarUrl(sub: any): string | null {
  const direct = pickFirstString(
    sub?.profile_pic,
    sub?.profile_pic_url,
    sub?.profilePicture,
    sub?.profile_picture,
    sub?.profile_picture_url,
    sub?.avatar,
    sub?.avatar_url,
    sub?.photo,
    sub?.photo_url,
    sub?.picture,
    sub?.picture_url,
  );
  if (direct && /^https?:\/\//i.test(direct)) return direct.trim();

  // fallback: пробуємо знайти URL в обʼєкті subscriber
  try {
    const visited = new WeakSet<Record<string, unknown>>();
    const walk = (node: unknown, depth: number): string | null => {
      if (node == null) return null;
      if (depth > 6) return null;
      if (typeof node === 'string') {
        const t = node.trim();
        if (t && /^https?:\/\//i.test(t)) return t;
        return null;
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
      for (const v of Object.values(rec)) {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
      return null;
    };
    return walk(sub, 0);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = getManyChatApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'ManyChat API key not configured (MANYCHAT_API_KEY)' },
      { status: 500 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const maxPages = Math.max(1, Math.min(50, Number(sp.get('maxPages') || 10) || 10));
  const pageSize = Math.max(10, Math.min(200, Number(sp.get('pageSize') || 100) || 100));
  const onlyMissing = sp.get('onlyMissing') !== '0';
  const dryRun = sp.get('dryRun') === '1';
  const limit = Math.max(0, Number(sp.get('limit') || 0) || 0); // 0 = без ліміту

  const startedAt = Date.now();

  const stats = {
    maxPages,
    pageSize,
    onlyMissing,
    dryRun,
    limit,
    pagesFetched: 0,
    subscribersScanned: 0,
    withInstagram: 0,
    withAvatar: 0,
    saved: 0,
    skippedExists: 0,
    skippedNoAvatar: 0,
    skippedNoInstagram: 0,
    errors: 0,
  };

  const errorDetails: Array<{ page: number; status: number; preview: string }> = [];
  let stoppedReason: string | null = null;

  const samples: Array<{ username: string; avatarUrl: string; action: string }> = [];

  console.log('[backfill-instagram-avatars] ▶️ Старт:', { maxPages, pageSize, onlyMissing, dryRun, limit });

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.manychat.com/fb/subscriber/getSubscribers?page=${page}&limit=${pageSize}`;
    let data: any = null;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await res.text();
      if (!res.ok) {
        stats.errors += 1;
        const preview = text.slice(0, 300);
        console.warn('[backfill-instagram-avatars] ⚠️ ManyChat відповів помилкою:', {
          page,
          status: res.status,
          preview,
        });
        if (errorDetails.length < 8) {
          errorDetails.push({ page, status: res.status, preview });
        }

        // Часті “фатальні” випадки — зупиняємось одразу, щоб не робити зайвих запитів
        if (res.status === 401 || res.status === 403) {
          stoppedReason = 'manychat_unauthorized';
          break;
        }
        if (res.status === 429) {
          stoppedReason = 'manychat_rate_limited';
          break;
        }
        continue;
      }
      data = JSON.parse(text);
      stats.pagesFetched += 1;
    } catch (err) {
      stats.errors += 1;
      console.warn('[backfill-instagram-avatars] ⚠️ Помилка запиту ManyChat:', { page, err: String(err) });
      if (errorDetails.length < 8) {
        errorDetails.push({ page, status: 0, preview: `request_error: ${String(err).slice(0, 280)}` });
      }
      continue;
    }

    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.subscribers) ? data.subscribers : [];
    if (!Array.isArray(list) || list.length === 0) {
      console.log('[backfill-instagram-avatars] 🟡 Сторінка порожня, зупиняємось:', { page });
      break;
    }

    for (const sub of list) {
      stats.subscribersScanned += 1;

      const username = pickInstagramUsername(sub);
      if (!username) {
        stats.skippedNoInstagram += 1;
        continue;
      }
      stats.withInstagram += 1;

      const avatarUrl = pickAvatarUrl(sub);
      if (!avatarUrl) {
        stats.skippedNoAvatar += 1;
        continue;
      }
      stats.withAvatar += 1;

      const key = directAvatarKey(username);
      if (onlyMissing) {
        try {
          const existing = await kvRead.getRaw(key);
          if (existing && typeof existing === 'string' && existing.trim()) {
            stats.skippedExists += 1;
            if (samples.length < 20) samples.push({ username, avatarUrl: existing.trim(), action: 'skip_exists' });
            continue;
          }
        } catch {
          // якщо читання KV впало — не блокуємо backfill, просто продовжуємо як overwrite
        }
      }

      if (!dryRun) {
        try {
          await kvWrite.setRaw(key, avatarUrl);
        } catch (err) {
          stats.errors += 1;
          console.warn('[backfill-instagram-avatars] ⚠️ Не вдалося записати в KV:', { username, key, err: String(err) });
          continue;
        }
      }

      stats.saved += 1;
      if (samples.length < 20) samples.push({ username, avatarUrl, action: dryRun ? 'dry_run' : 'saved' });

      if (limit > 0 && stats.saved >= limit) {
        console.log('[backfill-instagram-avatars] ✅ Досягнуто ліміт, зупинка:', { limit });
        break;
      }
    }

    if (limit > 0 && stats.saved >= limit) break;
  }

  const finishedAt = Date.now();
  const ms = finishedAt - startedAt;

  console.log('[backfill-instagram-avatars] ✅ Готово:', { ...stats, ms });

  return NextResponse.json({
    ok: true,
    stats: { ...stats, ms },
    samples,
    errorDetails,
    stoppedReason,
  });
}

