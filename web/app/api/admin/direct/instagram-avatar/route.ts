// web/app/api/admin/direct/instagram-avatar/route.ts
// Повертає аватарку Instagram (URL з KV) як redirect для відображення в адмін-таблиці.

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';
import { normalizeInstagram } from '@/lib/normalize';
import { getEnvValue } from '@/lib/env';
import { isPreviewDeploymentHost } from '@/lib/auth-preview';
import { verifyUserToken } from '@/lib/auth-rbac';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get('host') || '')) return true;
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
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

function normalizeSubscriberId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!s) return null;

  // якщо в KV/логах прийшло як JSON-рядок {"value":"209..."} — пробуємо розпарсити
  try {
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
      const parsed = JSON.parse(s) as any;
      const cand = parsed?.value ?? parsed?.result ?? parsed?.data ?? parsed;
      const candStr = typeof cand === 'string' ? cand.trim() : typeof cand === 'number' ? String(cand) : '';
      if (candStr) {
        const m = candStr.match(/\d+/);
        if (m?.[0]) return m[0];
      }
    }
  } catch {
    // ignore
  }

  const m = s.match(/\d+/);
  return m?.[0] ?? null;
}

function igAvatarPlaceholderResponse(): NextResponse {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" role="img" aria-label=""><rect fill="#e5e7eb" width="48" height="48" rx="24"/><circle cx="24" cy="19" r="7" fill="#9ca3af"/><path fill="#9ca3af" d="M10 42c0-7.7 7.2-14 14-14s14 6.3 14 14v2H10v-2z"/></svg>`;
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=120',
    },
  });
}

/** Не віддаємо браузеру 302 на Meta CDN — часто 403; тільки проксі або заглушка. */
function shouldProxyAvatarThroughServer(imageUrl: string): boolean {
  try {
    const h = new URL(imageUrl).hostname.toLowerCase();
    return (
      h.includes('cdninstagram.com') ||
      h.endsWith('instagram.com') ||
      h.includes('fbcdn.net') ||
      h.includes('fbsbx.com')
    );
  } catch {
    return false;
  }
}

type ProxyResult =
  | { ok: true; response: NextResponse }
  | { ok: false; reason: 'cdn_fail' };

/** Instagram CDN часто віддає 403 у браузері; тягнемо байти з сервера. */
async function tryProxyOrRedirectAvatar(
  _req: NextRequest,
  imageUrl: string,
  debug: boolean,
): Promise<ProxyResult> {
  if (!debug && shouldProxyAvatarThroughServer(imageUrl)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const upstream = await fetch(imageUrl, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://www.instagram.com/',
        },
      }).finally(() => clearTimeout(timer));

      if (upstream.ok) {
        const ct = upstream.headers.get('content-type') || '';
        if (ct.startsWith('image/')) {
          const buf = Buffer.from(await upstream.arrayBuffer());
          if (buf.length > 0 && buf.length < 4_000_000) {
            return {
              ok: true,
              response: new NextResponse(buf, {
                status: 200,
                headers: {
                  'Content-Type': ct,
                  'Cache-Control': 'private, max-age=300',
                },
              }),
            };
          }
        }
      } else {
        console.warn('[direct/instagram-avatar] Проксі CDN: upstream не ок', {
          status: upstream.status,
          previewUrlHost: new URL(imageUrl).hostname,
        });
      }
    } catch (err) {
      console.warn('[direct/instagram-avatar] Проксі CDN помилка:', err);
    }
    return { ok: false, reason: 'cdn_fail' };
  }

  const res = NextResponse.redirect(imageUrl, { status: 302 });
  res.headers.set('Cache-Control', 'private, max-age=300');
  return { ok: true, response: res };
}

function pickIgFromManychatItem(item: any): string | null {
  const candidate = pickFirstString(
    item?.ig_username,
    item?.instagram_username,
    item?.igUsername,
    item?.instagramUsername,
    item?.username,
  );
  if (!candidate) return null;
  const n = normalizeInstagram(candidate);
  return n && hasNormalInstagramUsername(n) ? n : null;
}

function normalizePersonNamePart(v: string | null | undefined): string {
  return (v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Чи ManyChat-картка збігається з first/last Direct-клієнта (щоб не чіпати чужі «Альона»). */
function manychatItemMatchesDirectName(
  item: any,
  firstName?: string | null,
  lastName?: string | null,
): boolean {
  const wantFirst = normalizePersonNamePart(firstName);
  const wantLast = normalizePersonNamePart(lastName);
  if (!wantFirst && !wantLast) return false;

  const itemFirst = normalizePersonNamePart(
    pickFirstString(item?.first_name, item?.firstName, item?.name?.first, item?.firstname),
  );
  const itemLast = normalizePersonNamePart(
    pickFirstString(item?.last_name, item?.lastName, item?.name?.last, item?.lastname),
  );
  const itemFull = normalizePersonNamePart(
    pickFirstString(item?.name, item?.full_name, item?.fullName, [itemFirst, itemLast].filter(Boolean).join(' ')),
  );

  if (wantFirst && wantLast) {
    if (itemFirst && itemLast) {
      return itemFirst === wantFirst && itemLast === wantLast;
    }
    // Лише повне ім'я в ManyChat — вимагаємо обидві частини в рядку
    if (itemFull) {
      return itemFull.includes(wantFirst) && itemFull.includes(wantLast);
    }
    return false;
  }

  // Без прізвища — лише точний збіг імені, і тільки якщо в ManyChat немає іншого прізвища
  if (wantFirst && !wantLast) {
    if (itemLast) return false;
    if (itemFirst) return itemFirst === wantFirst;
    if (itemFull) return itemFull === wantFirst;
  }
  return false;
}

/**
 * findByName → profile_pic / subscriber_id (коли в повідомленнях немає subscriberId).
 * Без expectedIg НЕ шукаємо лише по імені («Альона») — інакше чужий аватар потрапляє на клієнта без IG.
 */
async function findAvatarViaManychatNameSearch(opts: {
  apiKey: string;
  expectedIg: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ avatarUrl: string | null; subscriberId: string | null }> {
  const hasExpectedIg = Boolean(opts.expectedIg && hasNormalInstagramUsername(opts.expectedIg));
  const fn = (opts.firstName || '').trim();
  const ln = (opts.lastName || '').trim();
  const full = [fn, ln].filter(Boolean).join(' ').trim();

  const queries: string[] = [];
  const push = (v: string | null | undefined) => {
    const s = (v || '').trim();
    if (!s || queries.includes(s)) return;
    queries.push(s);
  };

  if (hasExpectedIg) {
    push(opts.expectedIg);
    push(`@${opts.expectedIg}`);
    // Додатково ПІБ — але матч нижче все одно по IG
    push(full);
  } else {
    // Без IG: лише повне «Ім'я Прізвище». Саме ім'я / саме прізвище — заборонено (дублікати типу Альона).
    if (!fn || !ln) {
      console.log('[direct/instagram-avatar] ⏭️ findByName без IG пропущено (немає повного ПІБ)', {
        firstName: fn || null,
        lastName: ln || null,
      });
      return { avatarUrl: null, subscriberId: null };
    }
    push(full);
  }

  for (const q of queries.slice(0, 4)) {
    try {
      const findUrl = `https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(findUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as any;
      const arr = Array.isArray(data?.data) ? data.data : [];
      if (!arr.length) continue;

      let best: any = null;
      if (hasExpectedIg) {
        best = arr.find((item: any) => pickIgFromManychatItem(item) === opts.expectedIg) || null;
      } else {
        const nameMatches = arr.filter((item: any) =>
          manychatItemMatchesDirectName(item, opts.firstName, opts.lastName),
        );
        if (nameMatches.length === 1) {
          best = nameMatches[0];
        } else if (nameMatches.length > 1) {
          console.log('[direct/instagram-avatar] ⚠️ findByName: кілька збігів по ПІБ — не беремо аватар', {
            q,
            count: nameMatches.length,
          });
        } else {
          console.log('[direct/instagram-avatar] ⏭️ findByName: відповіді є, але ПІБ не збігається', {
            q,
            results: arr.length,
          });
        }
      }
      if (!best) continue;

      const sid = best?.subscriber_id || best?.id || null;
      const avatar = pickAvatarUrlFromManychatResponse({ data: best }) || pickAvatarUrlFromManychatResponse(best);
      return {
        subscriberId: sid != null ? String(sid).trim() : null,
        avatarUrl: avatar,
      };
    } catch (err) {
      console.warn('[direct/instagram-avatar] findByName помилка:', { q, err });
    }
  }
  return { avatarUrl: null, subscriberId: null };
}

async function fetchAvatarViaGetInfo(
  apiKey: string,
  subscriberId: string,
): Promise<string | null> {
  const apiUrl = `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  const text = await res.text();
  if (res.status === 429) {
    console.warn('[direct/instagram-avatar] ⚠️ ManyChat rate limit (429)', { subscriberId });
    return null;
  }
  if (!res.ok) {
    console.warn('[direct/instagram-avatar] ⚠️ ManyChat getInfo не ок:', {
      status: res.status,
      preview: text.slice(0, 240),
      subscriberId,
    });
    return null;
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return pickAvatarUrlFromManychatResponse(parsed);
}

function pickSubscriberIdFromRawBody(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    const sid =
      parsed?.subscriber?.id ||
      parsed?.subscriber?.subscriber_id ||
      parsed?.subscriber_id ||
      parsed?.subscriberId ||
      parsed?.id ||
      null;
    if (sid != null && String(sid).trim()) return String(sid).trim();
  } catch {
    // ignore
  }
  const m =
    raw.match(/"subscriber_id"\s*:\s*"([^"]+)"/i) ||
    raw.match(/"subscriber_id"\s*:\s*(\d+)/i) ||
    raw.match(/subscriber\[id\]=([^&\s]+)/i);
  return m?.[1] ? String(m[1]).trim() : null;
}

function notFoundResponse(req: NextRequest, debug: boolean, debugInfo: Record<string, unknown>): NextResponse {
  // Завжди SVG для <img>, щоб не було порожнього білого кружка (JSON 404 → onError → display:none)
  if (!debug) {
    return igAvatarPlaceholderResponse();
  }
  return NextResponse.json({ ok: false, error: 'not_found', debug: debugInfo }, { status: 404 });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const usernameRaw = req.nextUrl.searchParams.get('username') || '';
    const clientIdParam = String(req.nextUrl.searchParams.get('clientId') || '').trim();
    const debug = req.nextUrl.searchParams.get('debug') === '1';
    const fetchRemote = req.nextUrl.searchParams.get('fetch') === '1';
    // getInfo / remote — з clientId/fetch; findByName обмежено (див. allowNameSearch)
    const allowRemoteFetch = debug || fetchRemote || Boolean(clientIdParam);

    let normalized =
      (hasNormalInstagramUsername(usernameRaw)
        ? normalizeInstagram(usernameRaw) || usernameRaw.trim().toLowerCase()
        : '') || '';
    if (!normalized && !clientIdParam) {
      return NextResponse.json({ ok: false, error: 'username or clientId required' }, { status: 400 });
    }

    let resolvedClientId = clientIdParam;
    let clientFirstName: string | null = null;
    let clientLastName: string | null = null;

    // Резолвимо клієнта: clientId → картка; або username → картка; відновлюємо реальний IG з повідомлень
    try {
      const { prisma } = await import('@/lib/prisma');
      const {
        getInstagramHandleFromClientMessages,
      } = await import('@/lib/direct-store');

      if (resolvedClientId) {
        const row = await prisma.directClient.findUnique({
          where: { id: resolvedClientId },
          select: { id: true, instagramUsername: true, firstName: true, lastName: true },
        });
        if (row) {
          clientFirstName = row.firstName ?? null;
          clientLastName = row.lastName ?? null;
          if (!normalized && hasNormalInstagramUsername(row.instagramUsername)) {
            normalized = normalizeInstagram(row.instagramUsername) || String(row.instagramUsername).trim().toLowerCase();
          }
        }
        if (!normalized) {
          const fromMsg = await getInstagramHandleFromClientMessages(resolvedClientId);
          if (fromMsg && hasNormalInstagramUsername(fromMsg)) {
            normalized = fromMsg;
            console.log('[direct/instagram-avatar] 🔎 IG з повідомлень', {
              clientId: resolvedClientId,
              username: normalized,
            });
          }
        }
      } else if (normalized) {
        const row = await prisma.directClient.findFirst({
          where: { instagramUsername: normalized },
          select: { id: true, firstName: true, lastName: true },
        });
        if (row) {
          resolvedClientId = row.id;
          clientFirstName = row.firstName ?? null;
          clientLastName = row.lastName ?? null;
        }
      }
    } catch (resolveErr) {
      console.warn('[direct/instagram-avatar] resolve client:', resolveErr);
    }

    let usernameKey = normalized && hasNormalInstagramUsername(normalized) ? directAvatarKey(normalized) : null;
    const clientKey = resolvedClientId ? directAvatarByClientKey(resolvedClientId) : null;
    const hasNormalIg = Boolean(normalized && hasNormalInstagramUsername(normalized));

    let url = '';
    if (usernameKey) {
      const raw = await kvRead.getRaw(usernameKey);
      if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) url = raw.trim();
    }
    // Без нормального IG НЕ читаємо clientKey одразу — там часто лежить чужий findByName (напр. інша «Альона»).
    // clientKey дозволений лише після аватара з повідомлень цього клієнта (див. нижче).
    if (!url && clientKey && hasNormalIg) {
      const raw = await kvRead.getRaw(clientKey);
      if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) url = raw.trim();
    } else if (!hasNormalIg && clientKey) {
      try {
        const raw = await kvRead.getRaw(clientKey);
        if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) {
          // Самолікування: прибираємо отруєний кеш, щоб таблиця не показувала чуже фото
          await kvWrite.setRaw(clientKey, '');
          console.log('[direct/instagram-avatar] 🧹 Очищено clientKey аватар без нормального IG', {
            clientId: resolvedClientId,
          });
        }
      } catch {
        // ignore
      }
    }

    const debugInfo: Record<string, unknown> = debug
      ? {
          username: normalized || null,
          clientId: resolvedClientId || null,
          kv: { avatarHit: Boolean(url) },
          manychat: {
            apiKeyPresent: Boolean(getManyChatApiKey()),
            getInfo: null as null | Record<string, unknown>,
            findByName: null as null | Record<string, unknown>,
          },
          subscriber: {
            fromKv: null as null | string,
            fromMessages: null as null | string,
            fromLogs: null as null | string,
            fromFindByName: null as null | string,
          },
        }
      : {};

    const persistUrl = async (found: string) => {
      url = found;
      try {
        // Без нормального IG зберігаємо лише на clientKey (не на чужий usernameKey)
        if (usernameKey && hasNormalIg) await kvWrite.setRaw(usernameKey, found);
        if (clientKey) await kvWrite.setRaw(clientKey, found);
      } catch {
        // некритично
      }
    };

    const clearCachedUrl = async () => {
      url = '';
      try {
        if (usernameKey) await kvWrite.setRaw(usernameKey, '');
        if (clientKey) await kvWrite.setRaw(clientKey, '');
      } catch {
        // ignore
      }
    };

    // 1) profile_pic з rawData повідомлень
    if ((!url || !/^https?:\/\//i.test(url)) && resolvedClientId) {
      try {
        const { getAvatarUrlFromClientMessages } = await import('@/lib/direct-store');
        const fromMsg = await getAvatarUrlFromClientMessages(resolvedClientId);
        if (fromMsg && /^https?:\/\//i.test(fromMsg)) {
          await persistUrl(fromMsg);
          console.log('[direct/instagram-avatar] ✅ Аватар з rawData', {
            username: normalized || null,
            clientId: resolvedClientId,
          });
        }
      } catch (msgAvatarErr) {
        console.warn('[direct/instagram-avatar] rawData avatar:', msgAvatarErr);
      }
    }

    // 2) subscriber_id → getInfo; або findByName по IG/ПІБ
    const missKey = resolvedClientId
      ? `direct:ig-avatar-miss-client:${resolvedClientId}:${normalized || '_'}`
      : normalized
        ? `direct:ig-avatar-miss:${normalized}`
        : null;
    // findByName: з нормальним IG — ок; без IG — лише явний fetch/debug і лише з повним ПІБ (див. findAvatarViaManychatNameSearch)
    const allowNameSearch =
      debug ||
      fetchRemote ||
      Boolean(resolvedClientId && normalized && hasNormalInstagramUsername(normalized));

    const tryRemoteAvatar = async (forceRefresh: boolean) => {
      if (!allowRemoteFetch && !forceRefresh) return;
      if (url && /^https?:\/\//i.test(url) && !forceRefresh) return;

      // Недавно вже пробували і нічого не знайшли — не спамимо ManyChat (fetch=1 з модалки ігнорує)
      if (!forceRefresh && !debug && !fetchRemote && missKey) {
        try {
          const miss = await kvRead.getRaw(missKey);
          if (miss === '1') {
            console.log('[direct/instagram-avatar] ⏭️ miss-cache, пропускаю remote', {
              username: normalized || null,
              clientId: resolvedClientId || null,
            });
            return;
          }
        } catch {
          // ignore
        }
      }

      let subscriberId = '';
      const apiKey = getManyChatApiKey();
      if (!apiKey) return;

      if (normalized && hasNormalInstagramUsername(normalized)) {
        const subRaw = await kvRead.getRaw(directSubscriberKey(normalized));
        subscriberId = typeof subRaw === 'string' ? subRaw.trim() : '';
        subscriberId = normalizeSubscriberId(subscriberId) || subscriberId;
        if (debug) (debugInfo.subscriber as any).fromKv = subscriberId || null;
      }

      if (!subscriberId && resolvedClientId) {
        try {
          const { prisma } = await import('@/lib/prisma');
          const withSub = await prisma.directMessage.findFirst({
            where: { clientId: resolvedClientId, subscriberId: { not: null } },
            orderBy: { receivedAt: 'desc' },
            select: { subscriberId: true },
          });
          if (withSub?.subscriberId) {
            subscriberId = normalizeSubscriberId(withSub.subscriberId) || withSub.subscriberId;
            if (debug) (debugInfo.subscriber as any).fromMessages = subscriberId;
          }
          if (!subscriberId) {
            const rows = await prisma.directMessage.findMany({
              where: { clientId: resolvedClientId, rawData: { not: null } },
              orderBy: { receivedAt: 'desc' },
              take: 20,
              select: { rawData: true },
            });
            for (const row of rows) {
              const sid = pickSubscriberIdFromRawBody(row.rawData || '');
              if (sid) {
                subscriberId = normalizeSubscriberId(sid) || sid;
                if (debug) (debugInfo.subscriber as any).fromMessages = subscriberId;
                break;
              }
            }
          }
        } catch (subErr) {
          console.warn('[direct/instagram-avatar] subscriber from messages:', subErr);
        }
      }

      if (!subscriberId && normalized && hasNormalInstagramUsername(normalized)) {
        try {
          const items = await kvRead.lrange('manychat:webhook:log', 0, 199);
          for (const it of items) {
            const entry = parseKvLogEntry(it);
            if (!entry) continue;
            const sid = pickSubscriberIdFromWebhookLogEntry(entry, normalized);
            if (sid) {
              subscriberId = normalizeSubscriberId(sid) || sid;
              if (debug) (debugInfo.subscriber as any).fromLogs = subscriberId;
              try {
                await kvWrite.setRaw(directSubscriberKey(normalized), subscriberId);
              } catch {
                // ignore
              }
              break;
            }
          }
        } catch (err) {
          console.warn('[direct/instagram-avatar] webhook log scan:', err);
        }
      }

      // Немає subscriberId — шукаємо в ManyChat по ніку / ПІБ (обережно з RPS)
      if (!subscriberId && (allowNameSearch || forceRefresh || fetchRemote)) {
        console.log('[direct/instagram-avatar] 🔎 findByName (нема subscriberId)', {
          username: normalized || null,
          clientId: resolvedClientId || null,
          name: [clientFirstName, clientLastName].filter(Boolean).join(' ') || null,
        });
        const found = await findAvatarViaManychatNameSearch({
          apiKey,
          expectedIg: normalized && hasNormalInstagramUsername(normalized) ? normalized : null,
          firstName: clientFirstName,
          lastName: clientLastName,
        });
        if (debug) {
          (debugInfo.manychat as any).findByName = {
            avatar: Boolean(found.avatarUrl),
            subscriberId: found.subscriberId,
          };
        }
        if (found.subscriberId) {
          subscriberId = normalizeSubscriberId(found.subscriberId) || found.subscriberId;
          if (debug) (debugInfo.subscriber as any).fromFindByName = subscriberId;
          if (normalized && hasNormalInstagramUsername(normalized)) {
            try {
              await kvWrite.setRaw(directSubscriberKey(normalized), subscriberId);
            } catch {
              // ignore
            }
          }
        }
        if (found.avatarUrl) {
          await persistUrl(found.avatarUrl);
          console.log('[direct/instagram-avatar] ✅ Аватар з findByName', {
            username: normalized || null,
            clientId: resolvedClientId || null,
          });
          return;
        }
      }

      if (subscriberId) {
        console.log('[direct/instagram-avatar] 🖼️ ManyChat getInfo', {
          username: normalized || null,
          clientId: resolvedClientId || null,
          subscriberId,
          forceRefresh,
        });
        try {
          const fetched = await fetchAvatarViaGetInfo(apiKey, subscriberId);
          if (debug) {
            (debugInfo.manychat as any).getInfo = { ok: Boolean(fetched), subscriberId };
          }
          if (fetched) {
            await persistUrl(fetched);
            if (normalized && hasNormalInstagramUsername(normalized)) {
              try {
                await kvWrite.setRaw(directSubscriberKey(normalized), subscriberId);
              } catch {
                // ignore
              }
            }
            console.log('[direct/instagram-avatar] ✅ Підтягнув і зберіг аватарку в KV', {
              username: normalized || null,
              clientId: resolvedClientId || null,
            });
          }
        } catch (err) {
          console.warn('[direct/instagram-avatar] ⚠️ ManyChat getInfo error:', err);
          if (debug) {
            (debugInfo.manychat as any).getInfo = {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
    };

    await tryRemoteAvatar(false);

    if (!url || !/^https?:\/\//i.test(url)) {
      if (missKey && !debug) {
        try {
          // 6 год — щоб таблиця не дергала ManyChat на кожен reload
          await kvWrite.setRaw(missKey, '1');
        } catch {
          // ignore
        }
      }
      return notFoundResponse(req, debug, debugInfo);
    }

    // Успіх — знімаємо miss-cache
    if (missKey) {
      try {
        await kvWrite.setRaw(missKey, '');
      } catch {
        // ignore
      }
    }

    const proxied = await tryProxyOrRedirectAvatar(req, url, debug);
    if (proxied.ok) return proxied.response;

    // Прострочений CDN URL у KV — оновлюємо через ManyChat і пробуємо ще раз
    console.warn('[direct/instagram-avatar] ♻️ CDN fail → refresh avatar', {
      username: normalized || null,
      clientId: resolvedClientId || null,
    });
    await clearCachedUrl();
    await tryRemoteAvatar(true);

    if (url && /^https?:\/\//i.test(url)) {
      const again = await tryProxyOrRedirectAvatar(req, url, debug);
      if (again.ok) return again.response;
    }

    return igAvatarPlaceholderResponse();
  } catch (err) {
    console.error('[direct/instagram-avatar] ❌ Помилка:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
