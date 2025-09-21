// web/lib/kv.ts
// Мінімальна in-memory KV для Vercel (dev/demo).
// Підтримує kvGet, kvSet, kvMGet, kvZAdd, kvZRange у потрібних сигнатурах.

type Json = any;

type KVSetOptions = {
  ex?: number; // seconds (ігноруємо у простій in-memory реалізації)
};

type ZAddEntry = { score: number; member: string };
type ZRangeOptions = { rev?: boolean };

type KVState = {
  strings: Map<string, string>;          // key -> JSON string
  zsets: Map<string, ZAddEntry[]>;       // key -> sorted array by score ASC
};

const g = globalThis as any;
if (!g.__P30_KV__) {
  g.__P30_KV__ = {
    strings: new Map<string, string>(),
    zsets: new Map<string, ZAddEntry[]>(),
  } as KVState;
}
const KV: KVState = g.__P30_KV__;

/** ---------- String API ---------- */

export async function kvSet(key: string, value: Json, _opts?: KVSetOptions): Promise<"OK"> {
  KV.strings.set(key, JSON.stringify(value));
  return "OK";
}

export async function kvGet<T = Json>(key: string): Promise<T | null> {
  const raw = KV.strings.get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // fallback — зберігалось не як JSON
    return raw as unknown as T;
  }
}

export async function kvMGet(keys: string[]): Promise<(Json | null)[]> {
  const out: (Json | null)[] = [];
  for (const k of keys) {
    const raw = KV.strings.get(k);
    if (raw == null) {
      out.push(null);
    } else {
      try {
        out.push(JSON.parse(raw));
      } catch {
        out.push(raw);
      }
    }
  }
  return out;
}

/** ---------- ZSET helpers ---------- */

function getZSet(key: string): ZAddEntry[] {
  let arr = KV.zsets.get(key);
  if (!arr) {
    arr = [];
    KV.zsets.set(key, arr);
  }
  return arr;
}

function sortAsc(arr: ZAddEntry[]) {
  arr.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
}

/** kvZAdd(key, { score, member }) або kvZAdd(key, [{ score, member }, ...]) */
export async function kvZAdd(key: string, entry: ZAddEntry | ZAddEntry[]): Promise<number> {
  const arr = getZSet(key);
  const list = Array.isArray(entry) ? entry : [entry];

  let addedOrUpdated = 0;
  for (const e of list) {
    const idx = arr.findIndex((x) => x.member === String(e.member));
    if (idx >= 0) {
      // оновлюємо score
      if (arr[idx].score !== e.score) {
        arr[idx].score = e.score;
        addedOrUpdated++;
      }
    } else {
      arr.push({ score: e.score, member: String(e.member) });
      addedOrUpdated++;
    }
  }
  sortAsc(arr);
  return addedOrUpdated;
}

/**
 * kvZRange(key, start, stop, { rev })
 * Повертає масив members (string) у діапазоні індексів [start..stop] включно.
 * Індекси можуть бути від'ємними (як у Redis), -1 означає останній елемент.
 */
export async function kvZRange(
  key: string,
  start: number,
  stop: number,
  opts?: ZRangeOptions
): Promise<string[]> {
  const arr = getZSet(key).slice(); // копія
  const rev = !!opts?.rev;
  if (rev) arr.reverse();

  const n = arr.length;
  const norm = (i: number) => (i < 0 ? n + i : i);
  let s = norm(start);
  let e = norm(stop);

  // межі
  s = Math.max(0, s);
  e = Math.min(n - 1, e);
  if (n === 0 || s > e) return [];

  return arr.slice(s, e + 1).map((x) => x.member);
}

/** Допоміжне: очистити все (не в проді) */
export async function kvFlushAll(): Promise<void> {
  KV.strings.clear();
  KV.zsets.clear();
}
