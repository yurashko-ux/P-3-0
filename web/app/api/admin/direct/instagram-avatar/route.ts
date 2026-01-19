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

function parseKvLogEntry(raw: unknown): Record<string, unknown> | null {
  try {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      const once = JSON.parse(raw) as any;
      // інколи значення зберігається як JSON-рядок всередині JSON (double-encoded)
      if (typeof once === 'string') {
        const twice = JSON.parse(once) as any;
        if (twice && typeof twice === 'object' && !Array.isArray(twice)) return twice as Record<string, unknown>;
        return null;
      }
      if (once && typeof once === 'object' && !Array.isArray(once)) return once as Record<string, unknown>;
      return null;
    }
    if (typeof raw === 'object') {
      const obj = raw as any;
      if (typeof obj.value === 'string') {
        const once = JSON.parse(obj.value) as any;
        if (typeof once === 'string') {
          const twice = JSON.parse(once) as any;
          if (twice && typeof twice === 'object' && !Array.isArray(twice)) return twice as Record<string, unknown>;
          return null;
        }
        if (once && typeof once === 'object' && !Array.isArray(once)) return once as Record<string, unknown>;
        return null;
      }
      return obj as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function pickSubscriberIdFromWebhookLogEntry(entry: Record<string, unknown>, username: string): string | null {
  try {
    const rawBody = typeof (entry as any)?.rawBody === 'string' ? ((entry as any).rawBody as string) : '';
    if (!rawBody) return null;

    // ВАЖЛИВО: звіряємо username, щоб не підхопити subscriber_id чужого запису.
    // Шукаємо username і subscriber_id у сирому body (JSON або form-encoded)
    try {
      const parsed = JSON.parse(rawBody) as any;
      const u =
        (parsed?.username || parsed?.handle || parsed?.instagram_username || parsed?.ig_username || null) as string | null;
      const uNorm = (u || '').trim().toLowerCase().replace(/^@/, '');
      if (uNorm && uNorm !== username) return null;
      // якщо username співпав — можемо брати subscriberId із top-level entry
      const direct = (entry as any)?.subscriberId;
      if (direct != null && String(direct).trim()) return String(direct).trim();
      const sid =
        parsed?.subscriber?.id ||
        parsed?.subscriber?.subscriber_id ||
        parsed?.subscriber_id ||
        parsed?.subscriberId ||
        null;
      if (sid != null && String(sid).trim()) return String(sid).trim();
    } catch {
      // not json
    }

    try {
      const params = new URLSearchParams(rawBody);
      const u =
        params.get('username') ||
        params.get('handle') ||
        params.get('instagram_username') ||
        params.get('ig_username') ||
        null;
      const uNorm = (u || '').trim().toLowerCase().replace(/^@/, '');
      if (uNorm && uNorm !== username) return null;
      const direct = (entry as any)?.subscriberId;
      if (direct != null && String(direct).trim()) return String(direct).trim();
      const sid =
        params.get('subscriber[id]') ||
        params.get('subscriber_id') ||
        params.get('subscriberId') ||
        params.get('subscriber.id') ||
        null;
      if (sid && String(sid).trim()) return String(sid).trim();
    } catch {
      // ignore
    }

    // regex fallback
    const m =
      rawBody.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*"([^"]+)"/i) ||
      rawBody.match(/"subscriber"\s*:\s*\{[\s\S]*?"id"\s*:\s*(\d+)/i) ||
      rawBody.match(/"subscriber_id"\s*:\s*"([^"]+)"/i) ||
      rawBody.match(/"subscriber_id"\s*:\s*(\d+)/i);
    if (m?.[1]) return m[1].trim();
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usernameRaw = req.nextUrl.searchParams.get('username') || '';
    const debug = req.nextUrl.searchParams.get('debug') === '1';
    const fetchRemote = req.nextUrl.searchParams.get('fetch') === '1';
    const allowRemoteFetch = debug || fetchRemote;
    const normalized = normalizeInstagram(usernameRaw) || usernameRaw.trim().toLowerCase();
    if (!normalized) {
      return NextResponse.json({ ok: false, error: 'username missing' }, { status: 400 });
    }

    const key = directAvatarKey(normalized);
    const raw = await kvRead.getRaw(key);
    let url = typeof raw === 'string' ? raw.trim() : '';
    const debugInfo: Record<string, unknown> = debug
      ? {
          username: normalized,
          kv: {
            avatarKey: key,
            avatarHit: Boolean(url) && /^https?:\/\//i.test(url),
          },
          manychat: {
            apiKeyPresent: Boolean(getManyChatApiKey()),
            getInfo: null as null | Record<string, unknown>,
          },
          subscriber: {
            fromKv: null as null | string,
            fromLogs: null as null | string,
            scannedLogs: 0,
          },
        }
      : {};

    // Якщо в KV немає — (опційно) пробуємо підтягнути з ManyChat по subscriber_id.
    // ВАЖЛИВО: не робимо це за замовчуванням, щоб не вбити ManyChat по RPS під час рендеру таблиці.
    if (!url || !/^https?:\/\//i.test(url)) {
      const subRaw = await kvRead.getRaw(directSubscriberKey(normalized));
      let subscriberId = typeof subRaw === 'string' ? subRaw.trim() : '';
      const apiKey = getManyChatApiKey();
      if (debug) {
        (debugInfo.subscriber as any).fromKv = subscriberId || null;
        (debugInfo.manychat as any).apiKeyPresent = Boolean(apiKey);
      }

      // Якщо прямого мапінгу нема — пробуємо знайти subscriber_id у сирих webhook логах
      if (!subscriberId) {
        try {
          const scanParam = req.nextUrl.searchParams.get('scan');
          const scan = scanParam ? Math.min(Math.max(parseInt(scanParam, 10) || 200, 1), 2000) : 200;
          const items = await kvRead.lrange('manychat:webhook:log', 0, scan - 1);
          if (debug) (debugInfo.subscriber as any).scannedLogs = items.length;
          for (const it of items) {
            const entry = parseKvLogEntry(it);
            if (!entry) continue;
            const sid = pickSubscriberIdFromWebhookLogEntry(entry, normalized);
            if (sid) {
              subscriberId = sid;
              if (debug) (debugInfo.subscriber as any).fromLogs = subscriberId;
              try {
                await kvWrite.setRaw(directSubscriberKey(normalized), subscriberId);
              } catch {
                // некритично
              }
              console.log('[direct/instagram-avatar] 🔎 Знайшов subscriber_id у manychat:webhook:log', {
                username: normalized,
                subscriberId,
              });
              break;
            }
          }
        } catch (err) {
          console.warn('[direct/instagram-avatar] ⚠️ Не вдалося прочитати manychat:webhook:log:', err);
          if (debug) (debugInfo.subscriber as any).logsError = err instanceof Error ? err.message : String(err);
        }
      }

      if (allowRemoteFetch && subscriberId && apiKey) {
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
          if (debug) {
            (debugInfo.manychat as any).getInfo = {
              status: res.status,
              ok: res.ok,
              preview: text.slice(0, 220),
            };
          }
          if (res.status === 429) {
            // Не заспамлюємо ManyChat при RPS ліміті.
            // У debug/fetch режимі повертаємо 404 + debug, щоб було видно причину.
            console.warn('[direct/instagram-avatar] ⚠️ ManyChat rate limit (429)', { username: normalized });
          }
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
          if (debug) (debugInfo.manychat as any).getInfo = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        debug ? { ok: false, error: 'not_found', debug: debugInfo } : { ok: false, error: 'not_found' },
        { status: 404 },
      );
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

