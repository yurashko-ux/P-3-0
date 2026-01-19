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
import { getAllDirectClients } from '@/lib/direct-store';

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
  const onlyMissing = sp.get('onlyMissing') !== '0';
  const dryRun = sp.get('dryRun') === '1';
  const limit = Math.max(0, Number(sp.get('limit') || 0) || 0); // 0 = без ліміту
  const delayMs = Math.max(0, Math.min(2000, Number(sp.get('delayMs') || 150) || 150));
  const force = sp.get('force') === '1';

  const startedAt = Date.now();

  const stats = {
    onlyMissing,
    dryRun,
    limit,
    delayMs,
    force,
    clientsTotal: 0,
    usernamesUnique: 0,
    processed: 0,
    foundSubscriber: 0,
    withAvatar: 0,
    saved: 0,
    skippedExists: 0,
    invalidExisting: 0,
    skippedNoAvatar: 0,
    skippedNoInstagram: 0,
    errors: 0,
  };

  const errorDetails: Array<{ step: string; status: number; preview: string; username?: string; subscriberId?: string }> = [];
  let stoppedReason: string | null = null;

  const samples: Array<{ username: string; avatarUrl: string; action: string }> = [];

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  console.log('[backfill-instagram-avatars] ▶️ Старт:', { onlyMissing, dryRun, limit, delayMs });

  // 1) Беремо usernames з нашої бази Direct (це швидкий і контрольований backfill без getSubscribers).
  let clients: Array<{ instagramUsername: string }> = [];
  try {
    const all = await getAllDirectClients();
    clients = all.map((c) => ({ instagramUsername: c.instagramUsername }));
  } catch (err) {
    console.error('[backfill-instagram-avatars] ❌ Не вдалося завантажити клієнтів з БД:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load direct clients', details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  stats.clientsTotal = clients.length;

  const usernames = Array.from(
    new Set(
      clients
        .map((c) => normalizeInstagram(c.instagramUsername) || c.instagramUsername?.trim()?.toLowerCase())
        .filter((u): u is string => Boolean(u)),
    ),
  );
  stats.usernamesUnique = usernames.length;

  // 2) Для кожного username: findByName (GET) → subscriber_id → getInfo (GET) → avatar → KV
  for (const username of usernames) {
    if (limit > 0 && stats.saved >= limit) break;

    // пропускаємо службові/порожні
    if (!username || username === 'no instagram' || username.startsWith('no_instagram_') || username.startsWith('missing_instagram_')) {
      stats.skippedNoInstagram += 1;
      continue;
    }

    stats.processed += 1;

    const key = directAvatarKey(username);
    if (onlyMissing && !force) {
      try {
        const existing = await kvRead.getRaw(key);
        const existingStr = typeof existing === 'string' ? existing.trim() : '';
        const isValidUrl = Boolean(existingStr) && /^https?:\/\//i.test(existingStr);
        if (isValidUrl) {
          stats.skippedExists += 1;
          continue;
        }
        // Якщо значення є, але не схоже на URL — вважаємо “битим” і перезаписуємо.
        if (existingStr) {
          stats.invalidExisting += 1;
        }
      } catch {}
    }

    // findByName (судячи з тесту — endpoint існує, але POST не дозволений)
    const findUrl = `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(username)}`;
    let subscriberId: string | null = null;
    try {
      const res = await fetch(findUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await res.text();
      if (!res.ok) {
        stats.errors += 1;
        if (errorDetails.length < 12) errorDetails.push({ step: 'findByName', status: res.status, preview: text.slice(0, 280), username });
        if (res.status === 401 || res.status === 403) { stoppedReason = 'manychat_unauthorized'; break; }
        if (res.status === 429) { stoppedReason = 'manychat_rate_limited'; break; }
      } else {
        const data = JSON.parse(text);
        subscriberId = data?.data?.subscriber_id || data?.subscriber_id || data?.subscriber?.id || null;
      }
    } catch (err) {
      stats.errors += 1;
      if (errorDetails.length < 12) errorDetails.push({ step: 'findByName', status: 0, preview: `request_error: ${String(err).slice(0, 260)}`, username });
    }

    if (!subscriberId) {
      // Нема subscriber в ManyChat — пропускаємо
      if (delayMs) await sleep(delayMs);
      continue;
    }
    stats.foundSubscriber += 1;

    const infoUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`;
    let avatarUrl: string | null = null;
    try {
      const res = await fetch(infoUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await res.text();
      if (!res.ok) {
        stats.errors += 1;
        if (errorDetails.length < 12) errorDetails.push({ step: 'getInfo', status: res.status, preview: text.slice(0, 280), username, subscriberId });
        if (res.status === 401 || res.status === 403) { stoppedReason = 'manychat_unauthorized'; break; }
        if (res.status === 429) { stoppedReason = 'manychat_rate_limited'; break; }
      } else {
        const data = JSON.parse(text);
        avatarUrl = pickAvatarUrl(data?.data ?? data) || pickAvatarUrl(data);
      }
    } catch (err) {
      stats.errors += 1;
      if (errorDetails.length < 12) errorDetails.push({ step: 'getInfo', status: 0, preview: `request_error: ${String(err).slice(0, 260)}`, username, subscriberId });
    }

    if (!avatarUrl) {
      stats.skippedNoAvatar += 1;
      if (delayMs) await sleep(delayMs);
      continue;
    }
    stats.withAvatar += 1;

    if (!dryRun) {
      try {
        await kvWrite.setRaw(key, avatarUrl);
      } catch (err) {
        stats.errors += 1;
        if (errorDetails.length < 12) errorDetails.push({ step: 'kvWrite', status: 0, preview: `kv_error: ${String(err).slice(0, 260)}`, username, subscriberId });
        if (delayMs) await sleep(delayMs);
        continue;
      }
    }

    stats.saved += 1;
    if (samples.length < 20) samples.push({ username, avatarUrl, action: dryRun ? 'dry_run' : 'saved' });

    if (delayMs) await sleep(delayMs);
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

