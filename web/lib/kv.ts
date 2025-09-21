// web/lib/kv.ts
// Легка in-memory реалізація KV для Vercel/Next без зовнішніх залежностей.
// Підтримує: kvGet, kvSet, kvMGet, kvZAdd, kvZRange.
// У проді можна замінити на Upstash REST, зберігши ті самі сигнатури.

type ZEntry = { score: number; member: string };

type GlobalKVState = {
  kv: Map<string, string>;
  z: Map<string, ZEntry[]>;
};

const g = globalThis as any;
if (!g.__P30_KV__) {
  g.__P30_KV__ = { kv: new Map<string, string>(), z: new Map<string, ZEntry[]>() } as GlobalKVState;
}
const state: GlobalKVState = g.__P30_KV__;

// ---- helpers
function ensureZ(key: string): ZEntry[] {
  const arr = state.z.get(key);
  if (arr) return arr;
  const fresh: ZEntry[] = [];
  state.z.set(key, fresh);
  return fresh;
}

// ---- public api

// Отримати значення по ключу (JSON.parse)
export async function kvGet<T = any>(key: string): Promise<T | null> {
  const raw = state.kv.get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // якщо зберігли як рядок, повертаємо як є
    return raw as unknown as T;
  }
}

// Встановити значення по ключу (JSON.stringify). Параметр ex ігноруємо у in-memory варіанті.
export async function kvSet(key: string, value: any, _opts?: { ex?: number }): Promise<void> {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  state.kv.set(key, raw);
}

// Масове отримання кількох ключів
export async function kvMGet(keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const k of keys) {
    const v = await kvGet(k);
    out.push(v);
  }
  return out;
}

// Додати елемент у ZSET: kvZAdd(key, { score, member })
export async function kvZAdd(key: string, entry: ZEntry): Promise<void> {
  const arr = ensureZ(key);
  // замінимо існуючий member, якщо такий є
  const idx = arr.findIndex((e) => e.member === entry.member);
  if (idx >= 0) {
    arr[idx] = entry;
  } else {
    arr.push(entry);
  }
  // підтримуємо масив відсортованим за score зростаюче
  arr.sort((a, b) => a.score - b.score);
}

// Повернути діапазон членів (лише members), підтримує { rev: true } для зворотного порядку.
// start/end як у Redis: 0..-1 означає весь діапазон.
export async function kvZRange(
  key: string,
  start: number,
  end: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const arr = ensureZ(key);
  const src = opts?.rev ? [...arr].reverse() : arr;
  // нормалізація індексів як у Redis
  const N = src.length;
  const s = start < 0 ? Math.max(N + start, 0) : Math.min(start, N);
  const eInclusive = end < 0 ? N + end : end;
  const e = Math.min(Math.max(eInclusive, -1), N - 1);
  if (N === 0 || e < s) return [];
  return src.slice(s, e + 1).map((x) => x.member);
}

// (необов’язкове) Видалення ключа
export async function kvDel(key: string): Promise<void> {
  state.kv.delete(key);
}

// (необов’язкове) Отримати «сирі» дані для відладки
export function __kv_debug__() {
  return {
    kv_keys: Array.from(state.kv.keys()),
    z_keys: Array.from(state.z.keys()),
  };
}
