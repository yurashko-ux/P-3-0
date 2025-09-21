// web/lib/kv.ts
// Легкий REST-клієнт для Vercel KV (Upstash Redis) без залежності @vercel/kv

type Json = any;

const BASE = process.env.KV_REST_API_URL!;
const TOKEN = process.env.KV_REST_API_TOKEN!;

if (!BASE || !TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('KV env missing: KV_REST_API_URL / KV_REST_API_TOKEN');
}

async function kvCmd<T = any>(command: (string | number)[]): Promise<T> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command: command.map(String) }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV ${res.status} ${res.statusText}: ${text}`);
  }
  const json = (await res.json().catch(() => ({}))) as { result?: any };
  return (json?.result as T) ?? (undefined as unknown as T);
}

/** JSON-safe set (з optional TTL у секундах) */
export async function kvSet<T = Json>(
  key: string,
  value: T,
  opts?: { ex?: number }
) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (opts?.ex) {
    await kvCmd(['SET', key, payload, 'EX', opts.ex]);
  } else {
    await kvCmd(['SET', key, payload]);
  }
}

/** JSON-safe get */
export async function kvGet<T = Json>(key: string): Promise<T | null> {
  const raw = (await kvCmd<string | null>(['GET', key])) as any;
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
  const raw = (await kvCmd<Array<string | null>>(['MGET', ...keys])) ?? [];
  return raw.map((val) => {
    if (val == null) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return (val as unknown) as T;
    }
  });
}

/** Sorted Set: ZADD (один елемент) */
export async function kvZAdd(
  key: string,
  entry: { score: number; member: string }
) {
  await kvCmd(['ZADD', key, entry.score, entry.member]);
}

/** Sorted Set: ZRANGE start..stop (opts.rev === true -> ZREVRANGE) */
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const cmd = opts?.rev ? 'ZREVRANGE' : 'ZRANGE';
  const out = await kvCmd<string[]>([cmd, key, start, stop]);
  return Array.isArray(out) ? out.map(String) : [];
}

/** Явний реверсний рендж (для існуючого імпорту у UI) */
export async function kvZRevRange(
  key: string,
  start: number,
  stop: number
): Promise<string[]> {
  const out = await kvCmd<string[]>(['ZREVRANGE', key, start, stop]);
  return Array.isArray(out) ? out.map(String) : [];
}

/** Видалення ключа */
export async function kvDel(key: string) {
  await kvCmd(['DEL', key]);
}
