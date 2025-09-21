// web/lib/kv.ts
// Легка in-memory KV для локальної/верцел збірки без зовнішніх залежностей.
// Підтримує: kvGet, kvSet (TTL), kvMGet, kvZAdd, kvZRange({ rev }).

type KVValue = any;

type TTL = { ex?: number }; // seconds
type ZAddItem = { score: number; member: string };
type ZRangeOpts = { rev?: boolean };

type ZItem = { score: number; member: string };

const g = globalThis as any;

if (!g.__P30_KV__) {
  g.__P30_KV__ = {
    data: new Map<string, { v: KVValue; exp?: number }>(),
    zsets: new Map<string, ZItem[]>(),
  };
}

const store: {
  data: Map<string, { v: KVValue; exp?: number }>;
  zsets: Map<string, ZItem[]>;
} = g.__P30_KV__;

// -- helpers
function now() {
  return Date.now();
}

function cleanupKey(key: string) {
  const rec = store.data.get(key);
  if (!rec) return;
  if (rec.exp && rec.exp <= now()) {
    store.data.delete(key);
  }
}

function putZ(key: string, item: ZItem) {
  const arr = store.zsets.get(key) ?? [];
  // заміна по member (унікальність)
  const idx = arr.findIndex((x) => x.member === item.member);
  if (idx >= 0) arr.splice(idx, 1);
  // вставка відсортовано за score зростаюче
  // (проста вставка + сортування — для малих обсягів ок)
  arr.push(item);
  arr.sort((a, b) => a.score - b.score);
  store.zsets.set(key, arr);
}

// -- API

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  cleanupKey(key);
  const rec = store.data.get(key);
  return (rec ? (rec.v as T) : null);
}

export async function kvSet(key: string, value: KVValue, ttl?: TTL): Promise<'OK'> {
  const exMs = ttl?.ex ? now() + ttl.ex * 1000 : undefined;
  store.data.set(key, { v: value, exp: exMs });
  return 'OK';
}

// багаточитання
export async function kvMGet(keys: string[]): Promise<(KVValue | null)[]> {
  const out: (KVValue | null)[] = [];
  for (const k of keys) out.push(await kvGet(k));
  return out;
}

// ZSET add: один елемент
export async function kvZAdd(key: string, item: ZAddItem): Promise<number> {
  putZ(key, { score: item.score, member: String(item.member) });
  return 1;
}

// ZSET range: за індексами [start, stop] (як у Redis), з опцією rev
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: ZRangeOpts
): Promise<string[]> {
  const arr = store.zsets.get(key) ?? [];
  const data = opts?.rev ? [...arr].reverse() : arr;
  // нормалізуємо негативні індекси
  const n = data.length;
  let s = start < 0 ? n + start : start;
  let e = stop < 0 ? n + stop : stop;
  s = Math.max(0, s);
  e = Math.min(n - 1, e);
  if (e < s || n === 0) return [];
  return data.slice(s, e + 1).map((x) => x.member);
}

// (необов'язково) утиліти, якщо знадобляться пізніше
export async function kvDel(key: string): Promise<number> {
  const had = store.data.delete(key);
  return had ? 1 : 0;
}

export async function kvZCard(key: string): Promise<number> {
  return (store.zsets.get(key) ?? []).length;
}
