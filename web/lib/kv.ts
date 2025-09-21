// web/lib/kv.ts
// In-memory KV/ZSET fallback for dev/prod where @vercel/kv is unavailable.

type ZMember = { score: number; member: string };

const kvStore = new Map<string, any>();
const zsets = new Map<string, ZMember[]>();

export async function kvGet<T = any>(key: string): Promise<T | null> {
  return (kvStore.has(key) ? (kvStore.get(key) as T) : null);
}

export async function kvSet<T = any>(
  key: string,
  value: T,
  _opts?: { ex?: number } // TTL is ignored in this stub
): Promise<void> {
  kvStore.set(key, value);
}

export async function kvMGet(keys: string[]): Promise<any[]> {
  return Promise.all(keys.map((k) => kvGet(k)));
}

// Correct signature used across the project: kvZAdd(key, { score, member }) or array of such
export async function kvZAdd(
  key: string,
  entry: ZMember | ZMember[]
): Promise<void> {
  const items = Array.isArray(entry) ? entry : [entry];
  const list = zsets.get(key) ?? [];
  for (const e of items) {
    const i = list.findIndex((x) => x.member === e.member);
    if (i >= 0) list.splice(i, 1);
    list.push({ score: Number(e.score) || 0, member: String(e.member) });
  }
  zsets.set(key, list);
}

// kvZRange(key, start, stop, { rev?: true })
// stop is inclusive (Redis-like). Negative indexes supported.
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const list = (zsets.get(key) ?? []).slice();
  list.sort((a, b) => a.score - b.score);
  if (opts?.rev) list.reverse();

  const n = list.length;
  const from = start < 0 ? Math.max(n + start, 0) : start;
  const toIncl = stop < 0 ? n + stop : stop;
  const sliced = list.slice(from, toIncl === -1 ? undefined : toIncl + 1);
  return sliced.map((e) => e.member);
}
