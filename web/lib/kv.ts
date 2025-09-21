// web/lib/kv.ts
// ⚠️ Тимчасовий in-memory KV shim для розробки/деплою.
// Замінимо на справжній Vercel KV REST після стабілізації контрактів.

type AnyObj = Record<string, any>;

type ZItem = { score: number; member: string };

type KVStore = {
  data: Map<string, { value: any; exp?: number | null }>;
  zsets: Map<string, ZItem[]>;
};

declare global {
  // eslint-disable-next-line no-var
  var __KV_SHIM__: KVStore | undefined;
}

function store(): KVStore {
  if (!globalThis.__KV_SHIM__) {
    globalThis.__KV_SHIM__ = { data: new Map(), zsets: new Map() };
  }
  return globalThis.__KV_SHIM__;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function prune() {
  const s = store();
  const t = nowSec();
  for (const [k, v] of s.data.entries()) {
    if (v.exp && v.exp <= t) s.data.delete(k);
  }
}

// ----------------- Basic KV -----------------

/** kvSet(key, value, opts?: { ex?: seconds }) */
export async function kvSet(key: string, value: any, opts?: { ex?: number }) {
  prune();
  const s = store();
  const exp = opts?.ex ? nowSec() + opts.ex : null;
  s.data.set(key, { value, exp });
}

/** kvGet<T>(key) -> T | null */
export async function kvGet<T = any>(key: string): Promise<T | null> {
  prune();
  const s = store();
  const rec = s.data.get(key);
  if (!rec) return null;
  if (rec.exp && rec.exp <= nowSec()) {
    s.data.delete(key);
    return null;
  }
  return rec.value as T;
}

/** kvDel(key) */
export async function kvDel(key: string) {
  prune();
  store().data.delete(key);
}

/** kvMGet(keys[]) -> (any | null)[] */
export async function kvMGet(keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const k of keys) {
    // послідовно, щоб зберегти простоту
    // eslint-disable-next-line no-await-in-loop
    out.push(await kvGet(k));
  }
  return out;
}

// ----------------- Sorted Sets (ZSET) -----------------

/** kvZAdd(key, { score, member }) */
export async function kvZAdd(
  key: string,
  item: { score: number; member: string }
) {
  prune();
  const s = store();
  const arr = s.zsets.get(key) ?? [];
  // upsert по member
  const idx = arr.findIndex((x) => x.member === item.member);
  if (idx >= 0) {
    arr[idx] = { score: item.score, member: item.member };
  } else {
    arr.push({ score: item.score, member: item.member });
  }
  // сортуємо за score зростаюче (як у Redis)
  arr.sort((a, b) => a.score - b.score);
  s.zsets.set(key, arr);
}

/**
 * kvZRange(key, start, stop, opts?: { rev?: boolean })
 * Повертає масив member-ів у порядку score.
 * start/stop підтримують -1 як «кінець».
 */
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  prune();
  const s = store();
  let arr = [...(s.zsets.get(key) ?? [])];
  if (opts?.rev) arr = arr.slice().reverse();

  const n = arr.length;
  const from = start < 0 ? Math.max(n + start, 0) : start;
  const toRaw = stop < 0 ? n + stop : stop; // inclusive
  const to = Math.min(toRaw + 1, n); // зробимо exclusive для slice
  return arr.slice(from, to).map((x) => x.member);
}

/** Зручність для тестів: повне читання ZSET як пар */
export async function kvZRangeWithScores(
  key: string,
  opts?: { rev?: boolean }
): Promise<ZItem[]> {
  prune();
  const s = store();
  let arr = [...(s.zsets.get(key) ?? [])];
  if (opts?.rev) arr = arr.slice().reverse();
  return arr;
}

// ----------------- Helpers for JSON payloads -----------------

/** Безпечно зчитати JSON, якщо в сховищі рядок */
export function parseMaybeJSON<T = AnyObj>(val: any): T {
  if (val == null) return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as T;
    }
  }
  return val as T;
}
