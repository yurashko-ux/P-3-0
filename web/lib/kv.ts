// web/lib/kv.ts
// Мінімальний in-memory KV для Vercel (розробка/демо). Не персистентний між холодними стартами.

type ZEntry = { score: number; member: string };

type StoreShape = {
  kv: Map<string, any>;
  z: Map<string, ZEntry[]>;
};

function store(): StoreShape {
  const g = globalThis as any;
  if (!g.__P30_KV__) {
    g.__P30_KV__ = { kv: new Map<string, any>(), z: new Map<string, ZEntry[]>() } as StoreShape;
  }
  return g.__P30_KV__ as StoreShape;
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const s = store();
  return s.kv.has(key) ? (s.kv.get(key) as T) : null;
}

export async function kvSet(key: string, value: any, _opts?: { ex?: number }): Promise<"OK"> {
  const s = store();
  s.kv.set(key, value);
  return "OK";
}

export async function kvMGet(keys: string[]): Promise<any[]> {
  const s = store();
  return keys.map((k) => (s.kv.has(k) ? s.kv.get(k) : null));
}

// API, сумісне з нашим кодом: kvZAdd(key, { score, member })
export async function kvZAdd(key: string, entry: { score: number; member: string }): Promise<number> {
  const s = store();
  const list = s.z.get(key) ?? [];
  // видаляємо попередні дублікати member
  const filtered = list.filter((e) => e.member !== entry.member);
  filtered.push({ score: Number(entry.score) || Date.now(), member: String(entry.member) });
  // сортуємо за score ASC
  filtered.sort((a, b) => a.score - b.score);
  s.z.set(key, filtered);
  return 1;
}

// kvZRange(key, start, end, { rev?: true }) -> string[] members
export async function kvZRange(
  key: string,
  start: number,
  end: number,
  opts?: { rev?: boolean }
): Promise<string[]> {
  const s = store();
  const list = (s.z.get(key) ?? []).slice();
  if (!list.length) return [];
  const arr = opts?.rev ? list.slice().reverse() : list;
  // нормалізуємо індекси як у Redis
  const n = arr.length;
  const from = start < 0 ? Math.max(n + start, 0) : Math.min(start, n);
  const toRaw = end < 0 ? n + end : end;
  const to = Math.min(toRaw, n - 1);
  if (to < from) return [];
  return arr.slice(from, to + 1).map((e) => e.member);
}
