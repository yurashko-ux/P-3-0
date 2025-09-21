// web/lib/kv.ts
// Легкий REST-клієнт для Upstash/Vercel KV без @vercel/kv.
// Підтримує: kvGet, kvSet, kvMGet, kvZAdd, kvZRange.

type ZRangeOpts = { rev?: boolean };
type SetOpts = { ex?: number }; // seconds

const URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  '';
const TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  '';

if (!URL || !TOKEN) {
  // Не кидаємо помилку тут, щоб збірка не падала.
  // Але при першому виклику отримаєш зрозумілу помилку.
  // Додай ENV: KV_REST_API_URL & KV_REST_API_TOKEN (або Upstash аналоги).
  // Vercel → Settings → Environment Variables.
}

async function kvSend<T = any>(args: (string | number)[]): Promise<T> {
  if (!URL || !TOKEN) {
    throw new Error(
      'KV REST is not configured. Set KV_REST_API_URL & KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN).'
    );
  }
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    // Upstash REST не потребує cache, але щоб не було Next fetch cache:
    // @ts-ignore
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Upstash повертає { error: "..."} при помилці парсингу команди.
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(`KV ${res.status} ${res.statusText}: ${JSON.stringify(data) || msg}`);
  }
  return data.result as T;
}

// ---------- helpers ----------

function tryParse<T>(v: any): T | null {
  if (typeof v !== 'string') return (v as T) ?? (null as any);
  try {
    return JSON.parse(v) as T;
  } catch {
    return (v as any) as T;
  }
}

// ---------- API ----------

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const res = await kvSend<string | null>(['GET', key]);
  return res == null ? null : tryParse<T>(res);
}

export async function kvSet<T = any>(key: string, value: T, opts?: SetOpts): Promise<'OK'> {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (opts?.ex && Number.isFinite(opts.ex)) {
    return await kvSend(['SET', key, payload, 'EX', Math.floor(opts.ex!).toString()]);
  }
  return await kvSend(['SET', key, payload]);
}

export async function kvMGet<T = any>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  const res = await kvSend<(string | null)[]>(['MGET', ...keys]);
  return res.map((v) => (v == null ? null : tryParse<T>(v)));
}

export async function kvZAdd(
  key: string,
  entry: { score: number; member: string | number }
): Promise<number> {
  // ZADD key score member
  const { score, member } = entry;
  return await kvSend<number>(['ZADD', key, String(score), String(member)]);
}

export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: ZRangeOpts
): Promise<string[]> {
  // ZRANGE key start stop [REV]
  const args: (string | number)[] = ['ZRANGE', key, start, stop];
  if (opts?.rev) args.push('REV');
  return await kvSend<string[]>(args);
}
