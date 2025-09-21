// web/lib/kv.ts
import { kv } from '@vercel/kv';

/** Проста обгортка get */
export async function kvGet<T = any>(key: string): Promise<T | null> {
  return (await kv.get<T>(key)) ?? null;
}

/** set з optional TTL (ex у секундах) */
export async function kvSet(
  key: string,
  value: any,
  opts?: { ex?: number }
): Promise<'OK'> {
  if (opts?.ex) return kv.set(key, value, { ex: opts.ex });
  return kv.set(key, value);
}

/** del */
export async function kvDel(key: string): Promise<number> {
  return kv.del(key);
}

/**
 * ZADD: підтримує 2 сигнатури:
 *  - нова/бажана: kvZAdd(key, { score, member })
 *  - легасі:      kvZAdd(key, score, member)
 */
export async function kvZAdd(
  key: string,
  arg1: { score: number; member: string } | number,
  arg2?: string
): Promise<number> {
  if (typeof arg1 === 'number' && typeof arg2 !== 'undefined') {
    // легасі виклик (score, member)
    return kv.zadd(key, { score: arg1, member: arg2 });
  }
  // сучасний виклик
  return kv.zadd(key, arg1 as { score: number; member: string });
}

/**
 * ZRANGE з підтримкою { rev: true }
 */
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  if (opts?.rev) {
    return kv.zrange<string>(key, start, stop, { rev: true });
  }
  return kv.zrange<string>(key, start, stop);
}

/**
 * MGET для набору ключів. Повертає масив значень у тій же послідовності.
 * Значення можуть бути рядками або об'єктами — парсити вже у викликача, якщо потрібно.
 */
export async function kvMGet(keys: string[]): Promise<any[]> {
  if (!keys?.length) return [];
  // @vercel/kv підтримує varargs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (kv as any).mget(...keys)) ?? [];
}
