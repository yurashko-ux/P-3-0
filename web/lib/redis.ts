// web/lib/redis.ts
// Minimal in-memory Redis-like adapter for prod/dev parity.
// ❗️Ігнорує будь-які ENV і НІКУДИ ЗОВНІ НЕ ХОДИТЬ.

type Val = string;

// ---- Storage ----
const KV = new Map<string, Val>();
const ZS = new Map<string, Array<{ member: Val; score: number }>>();
const LS = new Map<string, Val[]>();

// ---- Helpers ----
function getZ(key: string) {
  if (!ZS.has(key)) ZS.set(key, []);
  return ZS.get(key)!;
}
function getL(key: string) {
  if (!LS.has(key)) LS.set(key, []);
  return LS.get(key)!;
}
function normRange(len: number, start: number, stop: number) {
  const s = start < 0 ? Math.max(0, len + start) : start;
  const e = stop < 0 ? len + stop : stop;
  return [s, Math.min(len - 1, e)];
}

// ---- Public API (subset compatible with our code) ----
export const redis = {
  async set(key: string, value: Val): Promise<'OK'> {
    KV.set(key, value);
    return 'OK';
  },

  async get(key: string): Promise<Val | null> {
    return KV.has(key) ? KV.get(key)! : null;
  },

  async mset(...entries: Array<string>): Promise<'OK'> {
    // usage: mset(k1, v1, k2, v2, ...)
    for (let i = 0; i < entries.length; i += 2) {
      KV.set(entries[i], entries[i + 1]);
    }
    return 'OK';
  },

  async mget(...keys: string[]): Promise<Array<Val | null>> {
    return keys.map((k) => (KV.has(k) ? KV.get(k)! : null));
  },

  // LPUSH key ...values  (add to head; we will display newest first)
  async lpush(key: string, ...values: Val[]): Promise<number> {
    const arr = getL(key);
    arr.unshift(...values);
    return arr.length;
  },

  // LRANGE key start stop (inclusive)
  async lrange(key: string, start: number, stop: number): Promise<Val[]> {
    const arr = getL(key);
    const [s, e] = normRange(arr.length, start, stop);
    return arr.slice(s, e + 1);
  },

  // ZADD key { score, member }
  async zadd(
    key: string,
    ...items: Array<{ score: number; member: Val }>
  ): Promise<number> {
    const z = getZ(key);
    let added = 0;
    for (const it of items) {
      const idx = z.findIndex((x) => x.member === it.member);
      if (idx >= 0) {
        z[idx].score = it.score;
      } else {
        z.push({ member: it.member, score: it.score });
        added++;
      }
    }
    return added;
  },

  // ZRANGE key start stop [opts]
  // opts.rev=true  -> by score desc (newest first)
  // opts.byScore=true with numeric start/stop treated as score range
  async zrange(
    key: string,
    start: number,
    stop: number,
    opts?: { rev?: boolean; byScore?: boolean }
  ): Promise<Val[]> {
    const z = getZ(key).slice();
    // sort by score asc by default
    z.sort((a, b) => (a.score === b.score ? 0 : a.score < b.score ? -1 : 1));
    if (opts?.rev) z.reverse();

    if (opts?.byScore) {
      // numeric range by score (inclusive)
      const filtered = z.filter((i) => i.score >= start && i.score <= stop);
      return filtered.map((i) => i.member);
    }

    const [s, e] = normRange(z.length, start, stop);
    return z.slice(s, e + 1).map((i) => i.member);
  },

  // TTL stub (no-op, returns 1 like EXPIRE succeeded)
  async expire(_key: string, _seconds: number): Promise<1> {
    return 1 as const;
  },
};

export default redis;
