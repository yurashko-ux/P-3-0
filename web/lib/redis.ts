// web/lib/redis.ts
// Гібридний Redis-адаптер: Vercel KV (Upstash REST) → fallback на in-memory.
// Підтримані методи: get, set, mget, zadd, zrange, lpush, lrange, del, expire.

type Val = string;
type Any = any;

const KV_URL   = process.env.KV_REST_API_URL || process.env.KV_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || '';

/** ——— Low-level REST виклик до Upstash KV */
async function kvCall<T = Any>(command: string[]): Promise<T> {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV not configured');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command }),
    // Уникаємо кешування на платформах
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV error: ${res.status} ${text}`);
  }
  const json = (await res.json().catch(() => ({}))) as { result?: Any };
  return json.result as T;
}

/** ——— In-memory fallback (волатильний, лише для локалки) */
const mem = new Map<string, Val>();
const lists = new Map<string, Val[]>();        // LIST key -> array (0 — новіший край після LPUSH)
const zsets = new Map<string, Array<{ m: Val; s: number }>>(); // ZSET key -> [{member, score}]

function ensureList(key: string) {
  if (!lists.has(key)) lists.set(key, []);
  return lists.get(key)!;
}
function ensureZset(key: string) {
  if (!zsets.has(key)) zsets.set(key, []);
  return zsets.get(key)!;
}

/** ——— High-level API */
export const redis = {
  // STRINGS
  async get(key: string): Promise<string | null> {
    if (KV_URL && KV_TOKEN) {
      return kvCall<string | null>(['GET', key]);
    }
    return mem.has(key) ? mem.get(key)! : null;
  },

  async set(key: string, value: string): Promise<'OK'> {
    if (KV_URL && KV_TOKEN) {
      return kvCall<'OK'>(['SET', key, value]);
    }
    mem.set(key, value);
    return 'OK';
  },

  async mget(...keys: string[]): Promise<(string | null)[]> {
    if (KV_URL && KV_TOKEN) {
      // Upstash підтримує MGET
      return kvCall<(string | null)[]>(['MGET', ...keys]);
    }
    return keys.map(k => (mem.has(k) ? mem.get(k)! : null));
  },

  // ZSET
  async zadd(key: string, item: { score: number; member: string }): Promise<number> {
    if (KV_URL && KV_TOKEN) {
      // ZADD key score member
      return kvCall<number>(['ZADD', key, String(item.score), item.member]);
    }
    const z = ensureZset(key);
    const idx = z.findIndex(e => e.m === item.member);
    if (idx >= 0) z.splice(idx, 1);
    z.push({ m: item.member, s: item.score });
    // Підтримуємо відсортований список за score зростанням
    z.sort((a, b) => a.s - b.s);
    return 1;
  },

  async zrange(
    key: string,
    start: number,
    stop: number,
    opts?: { rev?: boolean; byScore?: boolean }
  ): Promise<string[]> {
    if (KV_URL && KV_TOKEN) {
      // Новий синтаксис ZRANGE з опціями REV/BYSCORE
      const cmd = ['ZRANGE', key, String(start), String(stop)];
      if (opts?.byScore) cmd.push('BYSCORE');
      if (opts?.rev) cmd.push('REV');
      return kvCall<string[]>(cmd);
    }
    const z = ensureZset(key);
    const arr = opts?.rev ? [...z].sort((a, b) => b.s - a.s) : [...z];
    const slice = (() => {
      // підтримка індексів як у Redis: -1 — останній елемент
      const norm = (i: number) => (i < 0 ? arr.length + i : i);
      const s = Math.max(0, norm(start));
      const e = Math.min(arr.length - 1, norm(stop));
      if (e < s) return [] as typeof arr;
      return arr.slice(s, e + 1);
    })();
    return slice.map(e => e.m);
  },

  // LIST
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (KV_URL && KV_TOKEN) {
      // LPUSH key v1 v2 ...
      return kvCall<number>(['LPUSH', key, ...values]);
    }
    const arr = ensureList(key);
    for (const v of values) arr.unshift(v);
    return arr.length;
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (KV_URL && KV_TOKEN) {
      return kvCall<string[]>(['LRANGE', key, String(start), String(stop)]);
    }
    const arr = ensureList(key);
    const norm = (i: number) => (i < 0 ? arr.length + i : i);
    const s = Math.max(0, norm(start));
    const e = Math.min(arr.length - 1, norm(stop));
    if (e < s) return [];
    return arr.slice(s, e + 1);
  },

  // MISC
  async del(key: string): Promise<number> {
    if (KV_URL && KV_TOKEN) {
      return kvCall<number>(['DEL', key]);
    }
    const existed = mem.delete(key) ? 1 : 0;
    lists.delete(key);
    zsets.delete(key);
    return existed;
  },

  async expire(_key: string, _seconds: number): Promise<0 | 1> {
    // Для нашого кейсу не критично; у KV можна зробити ['EXPIRE', key, sec]
    try {
      if (KV_URL && KV_TOKEN) {
        return kvCall<0 | 1>(['EXPIRE', _key, String(_seconds)]);
      }
    } catch { /* ignore */ }
    return 0;
  },
};

export default redis;
