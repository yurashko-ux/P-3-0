// web/lib/kv.ts
// Легка in-memory реалізація KV для розробки/прев'ю на Vercel без @vercel/kv.
// ⚠️ Дані НЕ persistent. Підійде, щоб пройти build і поганяти ручки.
// API сумісний з тим, що використовує код проєкту.

export type KvSetOptions = { ex?: number }; // seconds (ігноруємо тут)
type ZEntry = { score: number; member: string };

const mem = new Map<string, any>();
const zsets = new Map<string, ZEntry[]>();

function getZ(key: string): ZEntry[] {
  if (!zsets.has(key)) zsets.set(key, []);
  return zsets.get(key)!;
}

export async function kvSet(key: string, value: any, _opts?: KvSetOptions) {
  mem.set(key, value);
  return 'OK';
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  return (mem.has(key) ? (mem.get(key) as T) : null);
}

export async function kvMGet(keys: string[]): Promise<any[]> {
  return keys.map((k) => (mem.has(k) ? mem.get(k) : null));
}

export async function kvDel(key: string): Promise<number> {
  return mem.delete(key) ? 1 : 0;
}

// Підтримуємо обидві сигнатури:
// kvZAdd(key, score, member)
// kvZAdd(key, { score, member })
export async function kvZAdd(
  key: string,
  a: number | { score: number; member: string },
  b?: string
): Promise<number> {
  let entry: ZEntry;
  if (typeof a === 'number') {
    if (typeof b !== 'string') throw new Error('kvZAdd(key, score, member) expects member as string');
    entry = { score: a, member: b };
  } else {
    entry = { score: a.score, member: String(a.member) };
  }
  const arr = getZ(key);
  const idx = arr.findIndex((e) => e.member === entry.member);
  if (idx >= 0) {
    arr[idx] = entry; // update score
    return 0;
  } else {
    arr.push(entry);
    return 1;
  }
}

// kvZRange(key, start, stop, { rev?: true })
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const arr = [...getZ(key)];
  arr.sort((x, y) => (opts?.rev ? y.score - x.score : x.score - y.score));
  const norm = (n: number) => (n < 0 ? arr.length + n : n);
  const s = Math.max(0, norm(start));
  const e = Math.min(arr.length - 1, norm(stop));
  if (arr.length === 0 || s > e) return [];
  return arr.slice(s, e + 1).map((e) => e.member);
}

// Додатково: отримати весь ZSET як пари (для дебагу, не обов'язково)
export async function kvZCard(key: string): Promise<number> {
  return getZ(key).length;
}
