// web/lib/redis.ts
// Safe shim for Redis client used by /api/logs and similar routes.
// Avoids compile-time dependency on '@upstash/redis'.
// Runtime: in-memory (volatile). Later we can switch to Upstash REST when ENV present.

type Val = string;
const store = new Map<string, Val | Val[]>();

function getList(key: string): Val[] {
  const cur = store.get(key);
  if (Array.isArray(cur)) return cur;
  const arr: Val[] = [];
  store.set(key, arr);
  return arr;
}

export const redis = {
  // LPUSH key value [value ...]
  async lpush(key: string, ...values: Val[]): Promise<number> {
    const arr = getList(key);
    // newest first, like LPUSH
    for (const v of values) arr.unshift(v);
    store.set(key, arr);
    return arr.length;
  },

  // LRANGE key start stop (stop inclusive)
  async lrange(key: string, start: number, stop: number): Promise<Val[]> {
    const arr = getList(key);
    const norm = (i: number) => (i < 0 ? arr.length + i : i);
    const s = Math.max(0, norm(start));
    const e = Math.min(arr.length - 1, norm(stop));
    if (e < s) return [];
    return arr.slice(s, e + 1);
  },

  // SET/GET simple string values (used occasionally)
  async set(key: string, value: Val): Promise<'OK'> {
    store.set(key, value);
    return 'OK';
  },
  async get(key: string): Promise<Val | null> {
    const v = store.get(key);
    return typeof v === 'string' ? v : null;
  },

  // DEL
  async del(key: string): Promise<number> {
    const existed = store.delete(key);
    return existed ? 1 : 0;
  },

  // ZADD/ZRANGE (basic, score:number)
  async zadd(key: string, score: number, member: Val): Promise<number> {
    const enc = Array.isArray(store.get(key)) ? (store.get(key) as Val[]) : [];
    // We'll encode as "score|member" and keep sorted by score asc
    const parsed = enc.map((x) => {
      const [s, ...m] = x.split('|');
      return { score: Number(s), member: m.join('|') };
    });
    const idx = parsed.findIndex((x) => x.member === member);
    if (idx >= 0) parsed[idx].score = score;
    else parsed.push({ score, member });
    parsed.sort((a, b) => a.score - b.score);
    const nextEnc = parsed.map((x) => `${x.score}|${x.member}`);
    store.set(key, nextEnc);
    return 1;
  },

  /**
   * ZRANGE key start stop [REV]
   * Shim supports an optional 4th argument options: { rev?: boolean }
   * Example: await redis.zrange('k', 0, -1, { rev: true })
   */
  async zrange(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean }
  ): Promise<Val[]> {
    const enc = Array.isArray(store.get(key)) ? (store.get(key) as Val[]) : [];
    // decode to [{score, member}] keeping ascending by score (as stored)
    const items = enc.map((x) => {
      const [s, ...m] = x.split('|');
      return { score: Number(s), member: m.join('|') };
    });

    // apply REV if requested
    if (options?.rev) items.reverse();

    const total = items.length;
    const norm = (i: number) => (i < 0 ? total + i : i);
    const s = Math.max(0, norm(start));
    const e = Math.min(total - 1, norm(stop));
    if (e < s || total === 0) return [];

    return items.slice(s, e + 1).map((x) => x.member);
  },

  // No-op for expiry in shim mode
  async expire(_key: string, _seconds: number): Promise<0 | 1> {
    return 0;
  },
};

export default redis;
