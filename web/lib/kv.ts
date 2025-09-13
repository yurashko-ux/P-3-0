// web/lib/kv.ts
// Універсальний wrapper для Vercel KV (Upstash REST) через /pipeline.
// Підтримує збереження будь-яких значень: якщо не string — серіалізує у JSON.

const BASE = process.env.KV_REST_API_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || "";

if (!BASE || !TOKEN) {
  // Не кидаємо помилку на імпорт, але кинемо при першому виклику.
  console.warn("[KV] Missing KV_REST_API_URL or KV_REST_API_TOKEN");
}

type Cmd = (string | number)[];

// Внутрішній виклик pipeline
async function kvCall(cmds: Cmd[] | Cmd): Promise<any[]> {
  if (!BASE || !TOKEN) throw new Error("KV env is not configured");
  const body = Array.isArray(cmds[0]) ? cmds : [cmds as Cmd];
  const res = await fetch(`${BASE}/pipeline`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[KV] ${res.status} ${res.statusText}: ${text}`);
  }
  const json = await res.json().catch(() => null);
  // Upstash повертає масив об’єктів { result: ... }
  return Array.isArray(json) ? json : [json];
}

function tryParse<T = unknown>(v: any): T | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v as T;
  const s = v.trim();
  if (!s) return "" as any;
  // Пробуємо розпарсити JSON, але не зобов’язуємо
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]")) || s.startsWith('"')) {
    try { return JSON.parse(s) as T; } catch { /* fallthrough */ }
  }
  return s;
}

/* ───────────────────────── Basic KV ───────────────────────── */

export async function kvGet<T = unknown>(key: string): Promise<T | string | null> {
  const [r] = await kvCall(["GET", key]);
  const val = r?.result ?? null;
  return tryParse<T>(val);
}

export async function kvSet(key: string, value: unknown, opts?: { ex?: number; px?: number }): Promise<void> {
  // Якщо значення не рядок — серіалізуємо в JSON
  const toStore = typeof value === "string" ? value : JSON.stringify(value);
  // Підтримка TTL (EX seconds / PX ms) якщо треба
  const args: (string | number)[] = ["SET", key, toStore];
  if (opts?.ex) args.push("EX", opts.ex);
  if (opts?.px) args.push("PX", opts.px);
  await kvCall(args);
}

export async function kvDel(key: string): Promise<void> {
  await kvCall(["DEL", key]);
}

export async function kvIncr(key: string, by: number = 1): Promise<number> {
  const cmd: Cmd = by === 1 ? ["INCR", key] : ["INCRBY", key, by];
  const [r] = await kvCall(cmd);
  return Number(r?.result ?? 0);
}

/* ───────────────────────── ZSET helpers ───────────────────────── */

export async function kvZAdd(key: string, score: number, member: string): Promise<void> {
  await kvCall(["ZADD", key, score, member]);
}

export async function kvZRem(key: string, member: string): Promise<void> {
  await kvCall(["ZREM", key, member]);
}

export async function kvZRemBatch(key: string, members: string[] = []): Promise<void> {
  if (!members.length) return;
  // Розіб’ємо на батчі по 200
  const chunk = 200;
  for (let i = 0; i < members.length; i += chunk) {
    const part = members.slice(i, i + chunk);
    await kvCall(["ZREM", key, ...part]);
  }
}

export async function kvZRange(key: string, start = 0, stop = -1): Promise<string[]> {
  const [r] = await kvCall(["ZRANGE", key, start, stop]);
  return (r?.result as string[]) ?? [];
}

export async function kvZRevRange(key: string, start = 0, stop = -1): Promise<string[]> {
  const [r] = await kvCall(["ZREVRANGE", key, start, stop]);
  return (r?.result as string[]) ?? [];
}
