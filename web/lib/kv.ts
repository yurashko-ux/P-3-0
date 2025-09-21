// web/lib/kv.ts
// Простий in-memory KV (без зовнішніх залежностей) з інтерфейсами kvGet/kvSet/kvMGet/kvZAdd/kvZRange.
// Підійде для білду та розробки. Пізніше можна підмінити на Upstash, зберігши ті ж сигнатури.

type ZEntry = { score: number; member: string };
type GlobalKVState = { kv: Map<string, string>; z: Map<string, ZEntry[]> };

const g = globalThis as any;
if (!g.__P30_KV__) g.__P30_KV__ = { kv: new Map(), z: new Map() } as GlobalKVState;
const state: GlobalKVState = g.__P30_KV__;

// helpers
function ensureZ(key: string): ZEntry[] {
  let arr = state.z.get(key);
  if (!arr) {
    arr = [];
    state.z.set(key, arr);
  }
  return arr;
}

// API
export async function kvGet<T = any>(key: string): Promise<T | null> {
  const raw = state.kv.get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export async function kvSet(key: string, value: any, _opts?: { ex?: number }): Promise<void> {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  state.kv.set(key, raw);
}

export async function kvMGet(keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const k of keys) out.push(await kvGet(k));
  return out;
}

// правильна сигнатура: kvZAdd(key, { score, member })
export async function kvZAdd(key: string, entry: ZEntry): Promise<void> {
  const arr = ensureZ(key);
  const i = arr.findIndex((e) => e.member === entry.member);
  if (i >= 0) arr[i] = entry;
  else arr.push(entry);
  arr.sort((a, b) => a.score - b.score);
}

// kvZRange(key, start, end, { rev })
export async function kvZRange(
  key: string,
  start: number,
  end: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const arr = ensureZ(key);
  const src = opts?.rev ? [...arr].reverse() : arr;
  const N = src.length;
  const s = start < 0 ? Math.max(N + start, 0) : Math.min(start, N);
  const eInc = end < 0 ? N + end : end;
  const e = Math.min(Math.max(eInc, -1), N - 1);
  if (N === 0 || e < s) return [];
  return src.slice(s, e + 1).map((x) => x.member);
}

// optional
export async function kvDel(key: string): Promise<void> {
  state.kv.delete(key);
}

export function __kv_debug__() {
  return { kv_keys: Array.from(state.kv.keys()), z_keys: Array.from(state.z.keys()) };
}
