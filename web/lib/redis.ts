// web/lib/redis.ts
// Легкий клієнт до Vercel KV (Upstash REST) з підтримкою: set, get, del, lpush, lrange
// Використовує стандартні змінні середовища Vercel KV:
// KV_REST_API_URL, KV_REST_API_TOKEN (і опційно KV_REST_API_READ_ONLY_TOKEN)

type UpstashResult<T = any> = { result: T };

const URL_BASE =
  process.env.KV_REST_API_URL ||
  process.env.KV_URL || // fallback, якщо раптом
  '';

const TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.KV_REST_API_READ_ONLY_TOKEN ||
  '';

if (!URL_BASE || !TOKEN) {
  // Не кидаємо помилку тут, але дамо зрозуміти в рантаймі
  // при першому виклику методу.
  console.warn('[redis.ts] Missing KV_REST_API_URL / KV_REST_API_TOKEN envs');
}

async function callSingle<T = any>(command: (string | number)[]) {
  if (!URL_BASE || !TOKEN) {
    throw new Error('KV env is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)');
  }

  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    // Upstash добре працює і на edge, і на node, без спец. опцій
  });

  const text = await res.text();
  // Upstash завжди повертає JSON { result: ... } або { error: ... }
  // але перестрахуємось на випадок порожнього тіла.
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    // якщо прийшла помилка від REST: збережемо текст
    throw new Error(`REST_ERROR ${res.status}: ${text || res.statusText}`);
  }
  // якщо немає json або поля result — теж вважай за помилку формату
  if (!json || typeof json !== 'object' || !('result' in json)) {
    throw new Error(`Unexpected KV response: ${text}`);
  }
  return (json as UpstashResult<T>).result;
}

export const redis = {
  // STRING
  async set(key: string, value: string) {
    // SET key value
    return callSingle<string>(['SET', key, value]);
  },
  async get(key: string) {
    // GET key
    return callSingle<string | null>(['GET', key]);
  },
  async del(key: string) {
    // DEL key
    return callSingle<number>(['DEL', key]);
  },

  // LIST
  async lpush(key: string, ...values: string[]) {
    // LPUSH key v1 v2 ...
    return callSingle<number>(['LPUSH', key, ...values]);
  },
  async ltrim(key: string, start: number, stop: number) {
    // LTRIM key start stop
    return callSingle<number>(['LTRIM', key, String(start), String(stop)]);
  },
  async lrange(key: string, start: number, stop: number) {
    // LRANGE key start stop
    return callSingle<string[]>(['LRANGE', key, String(start), String(stop)]);
  },

  // (опційно, якщо десь ще кличеться)
  async rpush(key: string, ...values: string[]) {
    return callSingle<number>(['RPUSH', key, ...values]);
  },
  async expire(key: string, seconds: number) {
    return callSingle<number>(['EXPIRE', key, String(seconds)]);
  },

  // health-check
  async ping() {
    return callSingle<string>(['PING']);
  },
};
