// web/lib/kv.ts
import { kv } from '@vercel/kv';

type Json = any;

/** JSON-safe set (з optional TTL у секундах) */
export async function kvSet<T = Json>(
  key: string,
  value: T,
  opts?: { ex?: number }
) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (opts?.ex) {
    await kv.set(key, payload, { ex: opts.ex });
  } else {
    await kv.set(key, payload);
  }
}

/** JSON-safe get */
export async function kvGet<T = Json>(key: string): Promise<T | null> {
  const raw = (await kv.get<string | object>(key)) as any;
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return (raw as unknown) as T;
  }
}

/** Batched get по кількох ключах (повертає масив значень 1:1 з keys) */
export async function kvMGet<T = Json>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  // @vercel/kv підтримує mget(...keys)
  const raw = (await (kv as any).mget(...keys)) as Array<string | object | null>;
  return raw.map((val) => {
    if (val == null) return null;
    if (typeof val === 'object') return val as T;
    try {
      return JSON.parse(String(val)) as T;
    } catch {
      return (val as unknown) as T;
    }
  });
}

/** Sorted Set: ZADD */
export async function kvZAdd(
  key: string,
  entry: { score: number; member: string }
) {
  await kv.zadd(key, entry);
}

/** Sorted Set: ZRANGE (без опцій, як в @vercel/kv) */
export async function kvZRange(
  key: string,
  start: number,
  stop: number
): Promise<string[]> {
  // Вертає масив members (strings)
  return (await kv.zrange(key, start, stop)) as string[];
}

/** Видалення ключа */
export async function kvDel(key: string) {
  await kv.del(key);
}
