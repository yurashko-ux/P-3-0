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
    const arr = Array.isArray(store.get(key)) ? (store.get(key) as Val[]) : [];
    // We'll encode as "score|member" and keep sorted by score asc
    const parsed = (arr as Val[]).map((x) => {
      const [s, ...m] = x.split('|');
      return { score: Number(s), member: m.join('|') };
    });
    const idx = parsed.findIndex((x) => x.member === member);
    if (idx >= 0) parsed[idx].score = score;
    else parsed.push({ score, member });
    parsed.sort((a, b) => a.score - b.score);
    const enc = parsed.map((x) => `${x.score}|${x.member}`);
    store.set(key, enc);
    return 1;
  },
  async zrange(key: string, start: number, stop: number): Promise<Val[]> {
    const enc = Array.isArray(store.get(key)) ? (store.get(key) as Val[]) : [];
    const parsed = enc.map((x) => x.split('|').slice(1).join('|'));
    const norm = (i: number) => (i < 0 ? parsed.length + i : i);
    const s = Math.max(0, norm(start));
    const e = Math.min(parsed.length - 1, norm(stop));
    if (e < s) return [];
    return parsed.slice(s, e + 1);
  },

  // No-op for expiry in shim mode
  async expire(_key: string, _seconds: number): Promise<0 | 1> {
    return 0;
  },
};

export default redis;
