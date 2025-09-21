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
    for (const v of values) arr.unshift(v); // newest first
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

  // SET/GET simple string values
  async set(key: string, value: Val): Promise<'OK'> {
    store.set(key, value);
    return 'OK';
  },

  // Support generics like redis.get<string>(key)
  async get<T = string>(key: string): Promise<T | null> {
    const v = store.get(key);
    if (typeof v === 'string') return (v as unknown) as T;
    return null;
  },

  // MGET variadic: redis.mget(...keys)
  async mget<T = string>(...keys: string[]): Promise<(T | null)[]> {
    return keys.map((k) => {
      const v = store.get(k);
      return typeof v === 'string' ? ((v as unknown) as T) : null;
    });
  },

  // DEL
  async del(key: string): Promise<number> {
    const existed = store.delete(key);
    return existed ? 1 : 0;
  },

  // ZADD (supports two signatures):
  // 1) zadd(key, score:number, member:string)
  // 2) zadd(key, { score:number, member:string })
  async zadd(
    key: string,
    a: number | { score: number; member: Val },
    b?: Val
  ): Promise<number> {
    const enc = Array.isArray(store.get(key)) ? (store.get(key) as Val[]) : [];

    // decode to objects
    const parsed = enc.map((x) => {
      const [s, ...m] = x.split('|');
      return { score: Number(s), member: m.join('|') };
    });

    const { score, member } =
      typeof a === 'number' ? { score: a, member: b as Val } : a;

    const idx = parsed.findIndex((x) => x.member === member);
    if (idx >= 0) parsed[idx].score = score;
    else parsed.push({ score, member });

    parsed.sort((x, y) => x.score - y.score);
    const nextEnc = parsed.map((x) => `${x.score}|${x.member}`);
    store.set(key, nextEnc);
    return 1;
  },

  /**
   * ZRANGE:
   * - index mode: zrange(key, startIndex, stopIndex, { rev? })
   * - score mode: zrange(key, minScore, maxScore, { byScore: true, rev? })
   * Supports generic type param: redis.zrange<T>(...)
   */
  async zrange<T = string>(
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean; byScore?: boolean }
  ): Promise<T[]> {
    const enc = Array.isArray(store.get(key)) ? (store.get(key) as Val[]) : [];
    const items = enc.map((x) => {
      const [s, ...m] = x.split('|');
      return { score: Number(s), member: m.join('|') };
    });

    if (options?.byScore) {
      // filter by score range (inclusive)
      let filtered = items.filter((it) => it.score >= start && it.score <= stop);
      // default order is asc by score; apply REV if requested
      if (options?.rev) filtered = filtered.reverse();
      return filtered.map((x) => x.member as unknown as T);
    } else {
      // index-based slicing
      const total = items.length;
      if (options?.rev) items.reverse();
      const norm = (i: number) => (i < 0 ? total + i : i);
      const s = Math.max(0, norm(start));
      const e = Math.min(total - 1, norm(stop));
      if (e < s || total === 0) return [];
      return items.slice(s, e + 1).map((x) => x.member as unknown as T);
    }
  },

  async expire(_key: string, _seconds: number): Promise<0 | 1> {
    return 0; // no-op in shim
  },
};

export default redis;
