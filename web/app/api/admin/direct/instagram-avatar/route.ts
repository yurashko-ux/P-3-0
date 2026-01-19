// web/app/api/admin/direct/instagram-avatar/route.ts
// Повертає аватарку Instagram (URL з KV) як redirect для відображення в адмін-таблиці.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';
import { getEnvValue } from '@/lib/env';

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

const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
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

function pickFirstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const t = value.trim();
      if (t) return t;
    }
  }
  return null;
}

function pickAvatarUrlFromManychatResponse(anyResponse: unknown): string | null {
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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usernameRaw = req.nextUrl.searchParams.get('username') || '';
    const normalized = normalizeInstagram(usernameRaw) || usernameRaw.trim().toLowerCase();
    if (!normalized) {
      return NextResponse.json({ ok: false, error: 'username missing' }, { status: 400 });
    }

    const key = directAvatarKey(normalized);
    const raw = await kvRead.getRaw(key);
    let url = typeof raw === 'string' ? raw.trim() : '';

    // Якщо в KV немає — пробуємо ліниво підтягнути з ManyChat по subscriber_id (якщо він уже збережений)
    if (!url || !/^https?:\/\//i.test(url)) {
      const subRaw = await kvRead.getRaw(directSubscriberKey(normalized));
      const subscriberId = typeof subRaw === 'string' ? subRaw.trim() : '';
      const apiKey = getManyChatApiKey();
      if (subscriberId && apiKey) {
        const apiUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`;
        console.log('[direct/instagram-avatar] 🖼️ KV miss → пробую ManyChat getInfo…', {
          username: normalized,
          subscriberId,
        });
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(apiUrl, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));

          const text = await res.text();
          if (!res.ok) {
            console.warn('[direct/instagram-avatar] ⚠️ ManyChat getInfo не ок:', {
              status: res.status,
              preview: text.slice(0, 240),
              username: normalized,
              subscriberId,
            });
          } else {
            let parsed: any = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = null;
            }
            const fetched = pickAvatarUrlFromManychatResponse(parsed);
            if (fetched) {
              url = fetched;
              try {
                await kvWrite.setRaw(key, url);
              } catch {
                // некритично
              }
              console.log('[direct/instagram-avatar] ✅ Підтягнув і зберіг аватарку в KV', { username: normalized });
            }
          }
        } catch (err) {
          console.warn('[direct/instagram-avatar] ⚠️ ManyChat getInfo error:', err);
        }
      }
    }

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    const res = NextResponse.redirect(url, { status: 302 });
    // Кешуємо недовго, бо URL аватарок можуть змінюватись.
    res.headers.set('Cache-Control', 'private, max-age=300');
    return res;
  } catch (err) {
    console.error('[direct/instagram-avatar] ❌ Помилка:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

