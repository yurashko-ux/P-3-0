// web/lib/kv.ts
// Легка обгортка над Upstash Redis REST API під наші потреби.
// Потрібні env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

const URL_ = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

if (!URL_ || !TOKEN) {
  // не падаємо на імпорті, але підкажемо під час виконання
  // eslint-disable-next-line no-console
  console.warn(
    '[kv] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN. Set them in Vercel Project → Settings → Environment Variables.'
  );
}

type UpstashResp<T = any> = { result?: T; error?: string };

async function send<T = any>(command: string[]): Promise<T> {
  if (!URL_ || !TOKEN) {
    throw new Error('KV not configured: missing UPSTASH_* envs');
  }
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command }),
    // щоб роутери Next.js могли викликати з edge/Node середовищ
    cache: 'no-store',
  });

  const data = (await res.json()) as UpstashResp<T>;
  if (!res.ok || data.error) {
    throw new Error(`KV ${res.status} ${res.statusText}: ${JSON.stringify(data)}`);
  }
  return data.result as T;
}

// --- Публічні утиліти ---

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const raw = await send<string | null>(['GET', key]);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // якщо зберігали не JSON — повернемо як є
    return raw as unknown as T;
  }
}

export async function kvMGet<T = any>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  const arr = await send<(string | null)[]>(['MGET', ...keys]);
  return arr.map((raw) => {
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  });
}

export async function kvSet(
  key: string,
  value: any,
  opts?: { ex?: number } // ex = seconds TTL
): Promise<'OK'> {
  const payload = JSON.stringify(value);
  const cmd = ['SET', key, payload];
  if (opts?.ex && Number.isFinite(opts.ex)) {
    cmd.push('EX', String(opts.ex));
  }
  return await send<'OK'>(cmd);
}

// Sorted Set: додаємо один елемент
export async function kvZAdd(
  key: string,
  entry: { score: number; member: string }
): Promise<number> {
  return await send<number>(['ZADD', key, String(entry.score), entry.member]);
}

// Sorted Set: діапазон (опція REV підтримується)
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const cmd = ['ZRANGE', key, String(start), String(stop)];
  if (opts?.rev) cmd.push('REV');
  return await send<string[]>(cmd);
}
