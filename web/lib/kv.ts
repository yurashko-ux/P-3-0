// web/lib/kv.ts
// Легкий in-memory KV для Vercel/Next без залежностей.
// Підтримує: kvGet, kvSet, kvMGet, kvZAdd, kvZRange (з { rev }).

type ZItem = { score: number; member: string };

// Глобальні сховища, щоб переживали гарячі імпорти в одному рантаймі
const g = globalThis as any;
g.__KV_STORE__ ||= new Map<string, any>();
g.__ZSET_STORE__ ||= new Map<string, ZItem[]>();

const KV: Map<string, any> = g.__KV_STORE__;
const ZS: Map<string, ZItem[]> = g.__ZSET_STORE__;

// --- KV (get/set/mget) ---

export async function kvGet<T = any>(key: string): Promise<T | null> {
  return (KV.has(key) ? KV.get(key) : null) as T | null;
}

export async function kvSet(
  key: string,
  value: any,
  _opts?: { ex?: number } // TTL ігноруємо в in-memory режимі
): Promise<"OK"> {
  KV.set(key, value);
  return "OK";
}

export async function kvMGet(keys: string[]): Promise<any[]> {
  return keys.map((k) => (KV.has(k) ? KV.get(k) : null));
}

// --- ZSET (kvZAdd/kvZRange) ---

/**
 * Правильна сигнатура (узгоджено з нашим кодом):
 *   kvZAdd(key, { score, member })
 */
export async function kvZAdd(
  key: string,
  entry: { score: number; member: string }
): Promise<number> {
  const list = ZS.get(key) ?? [];
  const idx = list.findIndex((i) => i.member === entry.member);
  if (idx >= 0) {
    list[idx] = entry; // оновити score
  } else {
    list.push(entry);
  }
  // сортуємо по score зростаюче
  list.sort((a, b) => a.score - b.score);
  ZS.set(key, list);
  return 1;
}

/**
 * kvZRange(key, start, stop, { rev?: boolean })
 * Повертає масив member-ів у зрізі індексів (як в Redis).
 * stop = -1 означає до кінця.
 */
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  let list = (ZS.get(key) ?? []).slice();
  if (opts?.rev) list.reverse();

  const norm = (i: number, len: number) => (i < 0 ? len + i : i);
  const len = list.length;
  const s = Math.max(0, norm(start, len));
  const eRaw = norm(stop, len);
  const e = Math.min(len - 1, eRaw < 0 ? len - 1 : eRaw);

  if (len === 0 || s > e) return [];
  return list.slice(s, e + 1).map((it) => it.member);
}
