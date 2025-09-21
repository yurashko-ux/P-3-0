// web/lib/kv.ts
// Мінімальний клієнт для Vercel KV (Upstash REST).
// ВАЖЛИВО: будь-що, що не є рядком — stringify перед записом.

type AnyObj = Record<string, any>;

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

function ensureEnv() {
  if (!BASE || !TOKEN) {
    throw new Error('KV env missing: KV_REST_API_URL or KV_REST_API_TOKEN');
  }
}

async function send<T = any>(command: (string | number)[]): Promise<T> {
  ensureEnv();
  // Upstash очікує { command: [...] }
  const res = await fetch(BASE as string, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      command: command.map((c) => String(c)),
    }),
    // на Vercel edge важливо не кешувати
    cache: 'no-store',
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Повернемо текст помилки з тіла
    throw new Error(`KV ${res.status} ${res.statusText}: ${JSON.stringify(json)}`);
  }
  // Від Upstash приходить { result: ... }
  return (json && 'result' in json ? json.result : json) as T;
}

/** GET key -> T | null (авто JSON.parse, якщо можливо) */
export async function kvGet<T = any>(key: string): Promise<T | null> {
  const val = await send<string | null>(['GET', key]).catch(() => null);
  if (val == null) return null;
  if (typeof val === 'string') {
    // спробуємо розпарсити JSON
    try {
      return JSON.parse(val) as T;
    } catch {
      // повертаємо як є, якщо це звичайний рядок
      return val as unknown as T;
    }
  }
  return val as unknown as T;
}

/** SET key value (об’єкти/масиви stringify) */
export async function kvSet(
  key: string,
  value: any,
  opts?: { ex?: number } // seconds
): Promise<'OK'> {
  const stored =
    typeof value === 'string' ? value : JSON.stringify(value);
  if (opts?.ex && Number.isFinite(opts.ex)) {
    return await send(['SET', key, stored, 'EX', String(opts.ex)]);
  }
  return await send(['SET', key, stored]);
}

/** ZADD key score member */
export async function kvZAdd(
  key: string,
  score: number,
  member: string
): Promise<number> {
  return await send(['ZADD', key, String(score), member]);
}

/** ZRANGE / ZREVRANGE */
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  if (opts?.rev) {
    return await send(['ZREVRANGE', key, String(start), String(stop)]);
  }
  return await send(['ZRANGE', key, String(start), String(stop)]);
}

/** MGET keys... -> (string | null)[] (з авто JSON.parse по місцю використання) */
export async function kvMGet(keys: string[]): Promise<(string | null)[]> {
  if (!keys.length) return [];
  return await send(['MGET', ...keys]);
}
