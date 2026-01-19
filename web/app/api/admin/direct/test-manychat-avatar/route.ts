// web/app/api/admin/direct/test-manychat-avatar/route.ts
// Пробний endpoint: витягнути одну аватарку з ManyChat по subscriber_id (для дебагу).
// Увага: не логуємо токени/секрети.

import { NextRequest, NextResponse } from 'next/server';
import { kvWrite } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';
import { getEnvValue } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  // Зручний одноразовий доступ через ?token= (як /admin/login)
  if (ADMIN_PASS) {
    const qToken = (req.nextUrl.searchParams.get('token') || '').trim();
    if (qToken && qToken === ADMIN_PASS) return true;
  }

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

function pickFirstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const t = value.trim();
      if (t) return t;
    }
  }
  return null;
}

function pickAvatarUrl(anyResponse: unknown): string | null {
  try {
    const d: any = anyResponse as any;
    const node = d?.data ?? d;
    const direct = pickFirstString(
      node?.profile_pic,
      node?.profile_picture,
      node?.profile_pic_url,
      node?.profile_picture_url,
      node?.avatar,
      node?.avatar_url,
      node?.picture,
      node?.picture_url,
      node?.photo,
      node?.photo_url,
    );
    if (direct && /^https?:\/\//i.test(direct)) return direct.trim();
  } catch {
    // ignore
  }
  return null;
}

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
const directSubscriberKey = (username: string) => `direct:ig-subscriber:${username.toLowerCase()}`;

async function agentLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'test-manychat-avatar-1',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subscriberIdRaw = (req.nextUrl.searchParams.get('subscriber_id') || '').trim();
  const redirect = req.nextUrl.searchParams.get('redirect') === '1';
  const usernameRaw = (req.nextUrl.searchParams.get('username') || '').trim();
  const normalizedUsername = usernameRaw ? (normalizeInstagram(usernameRaw) || usernameRaw.toLowerCase()) : '';

  if (!subscriberIdRaw) {
    return NextResponse.json({ ok: false, error: 'subscriber_id missing' }, { status: 400 });
  }

  const apiKey = getManyChatApiKey();
  await agentLog('A', 'test-manychat-avatar:entry', 'Start getInfo', {
    hasApiKey: Boolean(apiKey),
    subscriberId: subscriberIdRaw,
    username: normalizedUsername || null,
    redirect,
  });

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'MANYCHAT_API_KEY missing on server' }, { status: 500 });
  }

  const apiUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberIdRaw)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    const avatarUrl = pickAvatarUrl(parsed);
    const igUsername = pickFirstString(parsed?.data?.ig_username, parsed?.data?.username);

    await agentLog('B', 'test-manychat-avatar:getInfo', 'ManyChat getInfo finished', {
      status: res.status,
      ok: res.ok,
      hasAvatarUrl: Boolean(avatarUrl),
      igUsername: igUsername ? String(igUsername).slice(0, 80) : null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'manychat_getInfo_failed', status: res.status, preview: text.slice(0, 400) },
        { status: 502 },
      );
    }

    if (!avatarUrl) {
      return NextResponse.json(
        { ok: false, error: 'avatar_not_found_in_response', preview: text.slice(0, 800) },
        { status: 404 },
      );
    }

    // Якщо передали username — збережемо в KV для таблиці (щоб одразу зʼявилась)
    // і перевіримо readback, щоб не було "savedToKv: true" без реального запису.
    let kvSave = { attempted: false, subscriberSaved: false, avatarSaved: false, readBackAvatar: null as null | string };
    if (normalizedUsername) {
      kvSave.attempted = true;
      try {
        await kvWrite.setRaw(directSubscriberKey(normalizedUsername), subscriberIdRaw);
        await kvWrite.setRaw(directAvatarKey(normalizedUsername), avatarUrl);
        kvSave.subscriberSaved = true;
        kvSave.avatarSaved = true;
        try {
          const { kvRead } = await import('@/lib/kv');
          const rb = await kvRead.getRaw(directAvatarKey(normalizedUsername));
          kvSave.readBackAvatar = typeof rb === 'string' ? rb.slice(0, 180) : rb ? String(rb).slice(0, 180) : null;
        } catch {}
        await agentLog('C', 'test-manychat-avatar:kv', 'Saved subscriber+avatar to KV', {
          username: normalizedUsername,
        });
      } catch (err) {
        kvSave.avatarSaved = false;
        kvSave.subscriberSaved = false;
        await agentLog('C', 'test-manychat-avatar:kv', 'Failed to save to KV', {
          username: normalizedUsername,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (redirect) {
      const out = NextResponse.redirect(avatarUrl, { status: 302 });
      out.headers.set('Cache-Control', 'private, max-age=60');

      // Якщо зайшли через ?token= — поставимо cookie, щоб не логінитись вдруге
      const qToken = (req.nextUrl.searchParams.get('token') || '').trim();
      if (ADMIN_PASS && qToken && qToken === ADMIN_PASS) {
        out.cookies.set('admin_token', qToken, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: true,
          maxAge: 60 * 60 * 24 * 7,
        });
      }

      return out;
    }

    return NextResponse.json({
      ok: true,
      subscriber_id: subscriberIdRaw,
      ig_username: igUsername || null,
      avatarUrl,
      savedToKv: kvSave.attempted ? (kvSave.avatarSaved && kvSave.subscriberSaved) : false,
      kv: kvSave.attempted ? kvSave : undefined,
    });
  } catch (err) {
    await agentLog('D', 'test-manychat-avatar:error', 'Unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

