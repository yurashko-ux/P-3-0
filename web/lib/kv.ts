// web/lib/kv.ts
// Легкий in-memory KV-поліфіл для локальної/тимчасової роботи на Vercel.
// Підтримує: kvGet, kvSet, kvMGet, kvZAdd, kvZRange
// ⚠️ Дані не persistent між інстансами; це стабілізує білд і API-контракти.

type KVSetOpts = { ex?: number }; // seconds
type ZAddItem = { score: number; member: string };
type ZRangeOpts = { rev?: boolean };

const store = new Map<string, { value: any; exp?: number }>();
const zsets = new Map<string, ZAddItem[]>();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function purgeIfExpired(key: string) {
  const rec = store.get(key);
  if (!rec) return;
  if (rec.exp && rec.exp <= nowSec()) {
    store.delete(key);
  }
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  purgeIfExpired(key);
  const rec = store.get(key);
  return (rec ? (rec.value as T) : null);
}

export async function kvSet(key: string, value: any, opts?: KVSetOpts): Promise<'OK'> {
  let exp: number | undefined = undefined;
  if (opts?.ex && opts.ex > 0) {
    exp = nowSec() + opts.ex;
  }
  store.set(key, { value, exp });
  return 'OK';
}

export async function kvMGet(keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const k of keys) {
    purgeIfExpired(k);
    out.push(store.get(k)?.value ?? null);
  }
  return out;
}

export async function kvZAdd(key: string, item: ZAddItem): Promise<number> {
  const arr = zsets.get(key) ?? [];
  // уникаємо дублікатів по member: оновлюємо score
  const idx = arr.findIndex((i) => i.member === item.member);
  if (idx >= 0) {
    arr[idx] = item;
  } else {
    arr.push(item);
  }
  zsets.set(key, arr);
  return 1;
}

export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: ZRangeOpts
): Promise<string[]> {
  const arr = (zsets.get(key) ?? []).slice().sort((a, b) => a.score - b.score);
  const data = opts?.rev ? arr.reverse() : arr;

  // нормалізація індексів на манер Redis
  const n = data.length;
  const norm = (i: number) => (i < 0 ? Math.max(n + i, 0) : i);
  let s = norm(start);
  let e = norm(stop);
  if (e >= n) e = n - 1;
  if (s > e || n === 0) return [];
  return data.slice(s, e + 1).map((i) => i.member);
}
