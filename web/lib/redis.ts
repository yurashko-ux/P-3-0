// web/lib/redis.ts
// Upstash KV → fallback in-memory. Підтримує: get, set, mget, mset, zadd, zrange, lpush, lrange, del, expire.

type Val = string;
type Any = any;

const KV_URL = process.env.KV_REST_API_URL || process.env.KV_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || '';

/** ---------- Upstash REST (robust: спершу single-command, при потребі pipeline) ---------- */
async function upstashCall<T = Any>(command: string[]): Promise<T> {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV not configured');

  // 1) single-command endpoint
  const single = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
    next: { revalidate: 0 },
  });

  if (single.ok) {
    const j = (await single.json().catch(() => ({}))) as { result?: Any };
    return j.result as T;
  }

  // 2) pipeline endpoint
  const pipeUrl = KV_URL.endsWith('/pipeline') ? KV_URL : `${KV_URL.replace(/\/+$/, '')}/pipeline`;
  const pipel = await fetch(pipeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: [command] }),
    next: { revalidate: 0 },
  });

  if (!pipel.ok) {
    const text = await pipel.text().catch(() => '');
    throw new Error(`KV error: ${pipel.status} ${text}`);
  }

  const arr = (await pipel.json().catch(() => [])) as Array<{ result?: Any }>;
  return (arr?.[0]?.result as T) ?? (undefined as unknown as T);
}

/** ---------- In-memory fallback ---------- */
const mem = new Map<string, Val>();
const lists = new Map<string, Val[]>();
const zsets = new Map<string, Array<{ m: Val; s: number }>>();

const getList = (k: string) => (lists.has(k) ? lists.get(k)! : (lists.set(k, []), lists.get(k)!));
const getZ = (k: string) => (zsets.has(k) ? zsets.get(k)! : (zsets.set(k, []), zsets.get(k)!));
const rangeIdx = (len: number, start: number, stop: number) => {
  const norm = (i: number) => (i < 0 ? len + i : i);
  const s = Math.max(0, norm(start));
  const e = Math.min(len - 1, norm(stop));
  return [s, e] as const;
};

/** ---------- Public API ---------- */
export const redis = {
  // STRINGS
  async get(key: string): Promise<string | null> {
    if (KV_URL && KV_TOKEN) return upstashCall<string | null>(['GET', key]);
    return mem.has(key) ? mem.get(key)! : null;
  },

  async set(key: string, value: string): Promise<'OK'> {
    if (KV_URL && KV_TOKEN) return upstashCall<'OK'>(['SET', key, value]);
    mem.set(key, value);
    return 'OK';
  },

  async mget(...keys: string[]): Promise<(string | null)[]> {
    if (KV_URL && KV_TOKEN) return upstashCall<(string | null)[]>(['MGET', ...keys]);
    return keys.map((k) => (mem.has(k) ? mem.get(k)! : null));
  },

  async mset(...kv: string[]): Promise<'OK'> {
    if (KV_URL && KV_TOKEN) {
      // перетворимо на pipeline
      const pipeUrl = KV_URL.endsWith('/pipeline') ? KV_URL : `${KV_URL.replace(/\/+$/, '')}/pipeline`;
      const commands: string[][] = [];
      for (let i = 0; i < kv.length; i += 2) commands.push(['SET', kv[i], kv[i + 1]]);
      const resp = await fetch(pipeUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
        next: { revalidate: 0 },
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`KV error: ${resp.status} ${t}`);
      }
      return 'OK';
    }
    for (let i = 0; i < kv.length; i += 2) mem.set(kv[i], kv[i + 1]);
    return 'OK';
  },

  // LIST
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (KV_URL && KV_TOKEN) return upstashCall<number>(['LPUSH', key, ...values]);
    const arr = getList(key);
    arr.unshift(...values);
    return arr.length;
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (KV_URL && KV_TOKEN) return upstashCall<string[]>(['LRANGE', key, String(start), String(stop)]);
    const arr = getList(key);
    const [s, e] = rangeIdx(arr.length, start, stop);
    return e < s ? [] : arr.slice(s, e + 1);
  },

  // ZSET
  async zadd(key: string, ...items: Array<{ score: number; member: string }>): Promise<number> {
    if (KV_URL && KV_TOKEN) {
      // single-command не підтримує кілька елементів одразу → зробимо pipeline
      const pipeUrl = KV_URL.endsWith('/pipeline') ? KV_URL : `${KV_URL.replace(/\/+$/, '')}/pipeline`;
      const commands = items.map((it) => ['ZADD', key, String(it.score), it.member]);
      const resp = await fetch(pipeUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
        next: { revalidate: 0 },
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`KV error: ${resp.status} ${t}`);
      }
      return items.length;
    }
    const z = getZ(key);
    let added = 0;
    for (const it of items) {
      const i = z.findIndex((e) => e.m === it.member);
      if (i >= 0) z[i].s = it.score;
      else {
        z.push({ m: it.member, s: it.score });
        added++;
      }
    }
    z.sort((a, b) => a.s - b.s);
    return added;
  },

  async zrange(
    key: string,
    start: number,
    stop: number,
    opts?: { rev?: boolean; byScore?: boolean }
  ): Promise<string[]> {
    if (KV_URL && KV_TOKEN) {
      const cmd = ['ZRANGE', key, String(start), String(stop)];
      if (opts?.byScore) cmd.push('BYSCORE');
      if (opts?.rev) cmd.push('REV');
      return upstashCall<string[]>(cmd);
    }
    const z = getZ(key).slice();
    z.sort((a, b) => a.s - b.s);
    if (opts?.rev) z.reverse();

    if (opts?.byScore) {
      const filtered = z.filter((i) => i.s >= start && i.s <= stop);
      return filtered.map((i) => i.m);
    }
    const [s, e] = rangeIdx(z.length, start, stop);
    return e < s ? [] : z.slice(s, e + 1).map((i) => i.m);
  },

  // MISC
  async del(key: string): Promise<number> {
    if (KV_URL && KV_TOKEN) return upstashCall<number>(['DEL', key]);
    const existed = mem.delete(key) ? 1 : 0;
    lists.delete(key);
    zsets.delete(key);
    return existed;
  },

  async expire(key: string, seconds: number): Promise<0 | 1> {
    if (KV_URL && KV_TOKEN) return upstashCall<0 | 1>(['EXPIRE', key, String(seconds)]);
    return 0;
  },
};

export default redis;
