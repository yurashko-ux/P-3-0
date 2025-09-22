// web/lib/redis.ts
// Легкий клієнт для Upstash Redis REST + безпечний fallback in-memory.
// Підтримує: set/get/del/expire, lpush/lrange, zadd/zrange, ping.

type Val = string;
type Any = any;

const REST_URL = process.env.KV_REST_API_URL || process.env.KV_URL || "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || "";

// ----------------- In-memory fallback (якщо немає REST env) -----------------
const _mem = {
  kv: new Map<string, string>(),
  lists: new Map<string, string[]>(),
  zsets: new Map<string, Array<{ score: number; member: string }>>(),
  expires: new Map<string, number>(), // key -> epoch ms
};

function _isExpired(key: string) {
  const exp = _mem.expires.get(key);
  if (exp && Date.now() > exp) {
    _mem.kv.delete(key);
    _mem.lists.delete(key);
    _mem.zsets.delete(key);
    _mem.expires.delete(key);
    return true;
  }
  return false;
}

function _ensureList(key: string) {
  if (!_mem.lists.has(key)) _mem.lists.set(key, []);
  return _mem.lists.get(key)!;
}
function _ensureZset(key: string) {
  if (!_mem.zsets.has(key)) _mem.zsets.set(key, []);
  return _mem.zsets.get(key)!;
}

// ----------------- REST executor -----------------
async function restExec(command: (string | number)[]): Promise<any> {
  if (!REST_URL || !REST_TOKEN) {
    throw new Error("NO_REST_ENV");
  }
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.error)) {
    const msg = typeof data?.error === "string" ? data.error : JSON.stringify(data);
    throw new Error(`REST_ERROR ${res.status}: ${msg}`);
  }
  return data?.result ?? data;
}

// ----------------- Публічне API -----------------
export const redis = {
  async ping(): Promise<string> {
    try {
      const r = await restExec(["PING"]);
      return typeof r === "string" ? r : "PONG";
    } catch {
      return "PONG";
    }
  },

  // KV
  async set(key: string, value: string): Promise<"OK"> {
    if (REST_URL && REST_TOKEN) {
      await restExec(["SET", key, value]);
      return "OK";
    }
    _mem.kv.set(key, value);
    return "OK";
  },

  async get(key: string): Promise<string | null> {
    if (REST_URL && REST_TOKEN) {
      const r = await restExec(["GET", key]);
      return r ?? null;
    }
    if (_isExpired(key)) return null;
    return _mem.kv.get(key) ?? null;
  },

  async del(key: string): Promise<number> {
    if (REST_URL && REST_TOKEN) {
      const r = await restExec(["DEL", key]);
      return Number(r) || 0;
    }
    _mem.kv.delete(key);
    _mem.lists.delete(key);
    _mem.zsets.delete(key);
    _mem.expires.delete(key);
    return 1;
  },

  async expire(key: string, seconds: number): Promise<number> {
    if (REST_URL && REST_TOKEN) {
      const r = await restExec(["EXPIRE", key, seconds]);
      return Number(r) || 0;
    }
    _mem.expires.set(key, Date.now() + seconds * 1000);
    return 1;
  },

  // LISTS
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (REST_URL && REST_TOKEN) {
      const r = await restExec(["LPUSH", key, ...values]);
      return Number(r) || 0;
    }
    const arr = _ensureList(key);
    arr.unshift(...values);
    return arr.length;
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (REST_URL && REST_TOKEN) {
      const r = await restExec(["LRANGE", key, start, stop]);
      return Array.isArray(r) ? r.map(String) : [];
    }
    if (_isExpired(key)) return [];
    const arr = _ensureList(key);
    const norm = (i: number) => (i < 0 ? arr.length + i : i);
    const s = Math.max(0, norm(start));
    const e = Math.min(arr.length - 1, norm(stop));
    if (e < s) return [];
    return arr.slice(s, e + 1);
  },

  // ZSET
  /**
   * Підтримувані форми:
   *  - zadd(key, score, member, opts?)
   *  - zadd(key, { score, member }, opts?)
   *  - zadd(key, [{ score, member }, ...], opts?)
   */
  async zadd(
    key: string,
    arg:
      | number
      | { score: number; member: string }
      | Array<{ score: number; member: string }>,
    member?: string,
    opts?: { nx?: boolean; xx?: boolean }
  ): Promise<number> {
    // Нормалізуємо до масиву пар {score, member}
    let pairs: Array<{ score: number; member: string }>;

    if (typeof arg === "number") {
      if (typeof member !== "string") throw new Error("zadd: member required");
      pairs = [{ score: arg, member }];
    } else if (Array.isArray(arg)) {
      pairs = arg;
    } else {
      pairs = [arg];
    }

    if (REST_URL && REST_TOKEN) {
      const cmd: (string | number)[] = ["ZADD", key];
      if (opts?.nx) cmd.push("NX");
      if (opts?.xx) cmd.push("XX");
      for (const p of pairs) {
        cmd.push(p.score, p.member);
      }
      const r = await restExec(cmd);
      return Number(r) || 0;
    }

    // fallback
    const z = _ensureZset(key);
    let added = 0;
    for (const p of pairs) {
      if (opts?.nx && z.some((i) => i.member === p.member)) continue;
      if (opts?.xx && !z.some((i) => i.member === p.member)) continue;
      const idx = z.findIndex((i) => i.member === p.member);
      if (idx >= 0) z[idx].score = p.score;
      else {
        z.push({ score: p.score, member: p.member });
        added++;
      }
    }
    z.sort((a, b) => a.score - b.score);
    return added;
  },

  /**
   * zrange(key, startOrMin, stopOrMax, options?)
   * - індексний режим: start, stop (+ опція { rev })
   * - за score: { byScore: true, rev?: boolean }
   */
  async zrange(
    key: string,
    a: number,
    b: number,
    options?: { rev?: boolean; byScore?: boolean; withScores?: boolean }
  ): Promise<string[]> {
    if (REST_URL && REST_TOKEN) {
      const cmd: (string | number)[] = ["ZRANGE", key, a, b];
      if (options?.byScore) cmd.splice(2, 2, a, b, "BYSCORE");
      if (options?.rev) cmd.push("REV");
      if (options?.withScores) cmd.push("WITHSCORES");
      const r = await restExec(cmd);
      return Array.isArray(r) ? r.map(String) : [];
    }

    if (_isExpired(key)) return [];
    const z = _ensureZset(key).slice();
    const src = options?.byScore
      ? z.filter((i) => i.score >= a && i.score <= b)
      : z.slice(Math.max(0, a), b < 0 ? z.length : b + 1);

    src.sort((x, y) => (options?.rev ? y.score - x.score : x.score - y.score));
    return src.map((i) => i.member);
  },
};
