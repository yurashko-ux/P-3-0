// web/lib/redis.ts
// KV client (Vercel KV / Upstash Redis) з авто-підбором формату pipeline + fallback на пам'ять.
// Підтримує: get, set, mget, mset, zadd, zrange, lpush, lrange, del, expire.

type Val = string;
type Any = any;

const KV_URL = process.env.KV_REST_API_URL || process.env.KV_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || '';

/** ---------------- Low-level helpers ---------------- */
async function httpJSON<T = Any>(url: string, body: any) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  });
  const text = await resp.text().catch(() => '');
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: resp.ok, status: resp.status, text, json };
}

// single-command endpoint (Vercel KV)
async function kvSingle<T = Any>(command: string[]): Promise<T> {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV not configured');
  const { ok, status, text, json } = await httpJSON(KV_URL, { command });
  if (!ok) throw new Error(`KV error: ${status} ${text}`);
  return (json?.result as T) ?? (undefined as unknown as T);
}

// pipeline endpoint — пробує три формати підряд, поки один не спрацює.
async function kvPipeline<T = Any>(commands: string[][]): Promise<T[]> {
  if (!KV_URL || !KV_TOKEN) throw new Error('KV not configured');

  // 1) Vercel KV format: POST {url}/multi-exec  with { commands: [ ["SET","k","v"], ... ] }
  {
    const multi = KV_URL.replace(/\/+$/, '') + '/multi-exec';
    const { ok, status, text, json } = await httpJSON(multi, { commands });
    if (ok && Array.isArray(json)) return json.map((x: any) => x?.result) as T[];
    // деякі інсталяції повертають помилку парсингу
  }

  // 2) Upstash Redis: POST {url}/pipeline with { commands: [...] }
  {
    const pipe = KV_URL.replace(/\/+$/, '') + '/pipeline';
    const { ok, status, text, json } = await httpJSON(pipe, { commands });
    if (ok && Array.isArray(json)) return json.map((x: any) => x?.result) as T[];
  }

  // 3) Upstash альтернативний: POST {url}/pipeline з чистим масивом [...], без обгортки
  {
    const pipe = KV_URL.replace(/\/+$/, '') + '/pipeline';
    const { ok, status, text, json } = await httpJSON(pipe, commands);
    if (ok && Array.isArray(json)) return json.map((x: any) => x?.result) as T[];
    throw new Error(`KV error: ${status} ${text || JSON.stringify(json) || 'ERR failed to parse pipeline request'}`);
  }
}

/** ---------------- In-memory fallback ---------------- */
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

/** ---------------- Public API ---------------- */
export const redis = {
  // STRINGS
  async get(key: string): Promise<string | null> {
    if (KV_URL && KV_TOKEN) return kvSingle<string | null>(['GET', key]);
    return mem.has(key) ? mem.get(key)! : null;
  },

  async set(key: string, value: string): Promise<'OK'> {
    if (KV_URL && KV_TOKEN) return kvSingle<'OK'>(['SET', key, value]);
    mem.set(key, value);
    return 'OK';
  },

  async mget(...keys: string[]): Promise<(string | null)[]> {
    if (KV_URL && KV_TOKEN) return kvSingle<(string | null)[]>(['MGET', ...keys]);
    return keys.map((k) => (mem.has(k) ? mem.get(k)! : null));
  },

  async mset(...kv: string[]): Promise<'OK'> {
    if (KV_URL && KV_TOKEN) {
      const cmds: string[][] = [];
      for (let i = 0; i < kv.length; i += 2) cmds.push(['SET', kv[i], kv[i + 1]]);
      await kvPipeline(cmds);
      return 'OK';
    }
    for (let i = 0; i < kv.length; i += 2) mem.set(kv[i], kv[i + 1]);
    return 'OK';
  },

  // LIST
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (KV_URL && KV_TOKEN) return kvSingle<number>(['LPUSH', key, ...values]);
    const arr = getList(key);
    arr.unshift(...values);
    return arr.length;
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (KV_URL && KV_TOKEN) return kvSingle<string[]>(['LRANGE', key, String(start), String(stop)]);
    const arr = getList(key);
    const [s, e] = rangeIdx(arr.length, start, stop);
    return e < s ? [] : arr.slice(s, e + 1);
  },

  // ZSET
  async zadd(key: string, ...items: Array<{ score: number; member: string }>): Promise<number> {
    if (KV_URL && KV_TOKEN) {
      // деякі бекенди не приймають кілька елементів у одному ZADD → робимо pipeline
      const cmds = items.map((it) => ['ZADD', key, String(it.score), it.member]);
      await kvPipeline(cmds);
      return items.length;
    }
    const z = getZ(key);
    let added = 0;
    for (const it of items) {
      const i = z.findIndex((e) => e.m === it.member);
      if (i >= 0) z[i].s = it.score;
      else { z.push({ m: it.member, s: it.score }); added++; }
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
      const cmd: string[] = ['ZRANGE', key, String(start), String(stop)];
      if (opts?.byScore) cmd.push('BYSCORE');
      if (opts?.rev) cmd.push('REV');
      return kvSingle<string[]>(cmd);
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
    if (KV_URL && KV_TOKEN) return kvSingle<number>(['DEL', key]);
    const existed = mem.delete(key) ? 1 : 0;
    lists.delete(key);
    zsets.delete(key);
    return existed;
  },

  async expire(key: string, seconds: number): Promise<0 | 1> {
    if (KV_URL && KV_TOKEN) return kvSingle<0 | 1>(['EXPIRE', key, String(seconds)]);
    return 0;
  },
};

export default redis;
