// web/lib/kv.ts
// Легка обгортка над Upstash/Vercel KV REST.
// Потрібні env: KV_REST_API_URL, KV_REST_API_TOKEN

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

if (!BASE || !TOKEN) {
  // Не кидаємо помилку одразу, щоб сторінки SSR не падали при білді.
  console.warn('[kv] Missing KV_REST_API_URL or KV_REST_API_TOKEN. KV calls will fail at runtime.');
}

async function redis<T = any>(...parts: (string | number)[]): Promise<T> {
  const url = `${BASE}/${parts.map(String).map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV ${res.status} ${res.statusText}: ${text}`);
  }
  const json = await res.json().catch(() => ({}));
  // Upstash відповідає { result: ... }
  return (json?.result ?? json) as T;
}

// ---- Public API ----

// GET key -> T | null
export async function kvGet<T = any>(key: string): Promise<T | null> {
  const v = await redis<any>('GET', key).catch(() => null);
  if (v == null) return null;
  // Пробуємо розпарсити JSON; якщо це простий тип — повертаємо як є
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return v as unknown as T;
    }
  }
  return v as T;
}

// SET key value (JSON) з опціями EX (секунди)
export async function kvSet(key: string, value: any, opts?: { ex?: number }): Promise<'OK'> {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (opts?.ex && Number.isFinite(opts.ex)) {
    return await redis<'OK'>('SET', key, payload, 'EX', opts.ex);
  }
  return await redis<'OK'>('SET', key, payload);
}

// ZADD key { score, member }
export async function kvZAdd(
  key: string,
  entry: { score: number; member: string | number }
): Promise<number> {
  // NX/CH не вмикаємо, щоб бути сумісними з існуючим кодом
  return await redis<number>('ZADD', key, entry.score, String(entry.member));
}

// ZRANGE key start stop (+ REV)
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  if (opts?.rev) {
    // Повертаємо лише members
    return await redis<string[]>('ZRANGE', key, start, stop, 'REV');
  }
  return await redis<string[]>('ZRANGE', key, start, stop);
}

// MGET keys[] -> (T | null)[]
export async function kvMGet<T = any>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  const res = await redis<any[]>('MGET', ...keys);
  // Upstash повертає масив сирих значень або null
  return res.map((v) => {
    if (v == null) return null;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    }
    return v as T;
  });
}
