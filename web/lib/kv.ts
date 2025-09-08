// web/lib/kv.ts
/**
 * Легкий клієнт для Vercel KV (REST).
 * Підтримує: get/set/del/zadd/zrem/zrange/zrevrange.
 * ADD-ONLY: додано kvGetJSON / kvSetJSON.
 */
const KV_URL = process.env.KV_REST_API_URL?.replace(/\/+$/, '') || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

const HEADERS: Record<string, string> = KV_TOKEN ? { Authorization: `Bearer ${KV_TOKEN}` } : {};

export type ZRangeOptions = { start: number; stop: number; withScores?: boolean };

export async function kvGet(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: HEADERS, cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null as any);
  return (j && typeof j.result === 'string') ? j.result : null;
}

export async function kvSet(key: string, value: string): Promise<boolean> {
  if (!KV_URL || !KV_TOKEN) return false;
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  return r.ok;
}

export async function kvDel(key: string): Promise<boolean> {
  if (!KV_URL || !KV_TOKEN) return false;
  const r = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, { method: 'POST', headers: HEADERS });
  return r.ok;
}

/**
 * ZADD із fallback-ланцюжком на різні REST-структури:
 * 1) Vercel KV: POST /zadd/<key>  { score, member }
 * 2) Upstash alt: POST /zadd/<key> { members: [{ score, member }] }
 * 3) Path-варіант: POST /zadd/<key>/<score>/<member>
 */
export async function kvZAdd(key: string, score: number, member: string): Promise<boolean> {
  if (!KV_URL || !KV_TOKEN) return false;

  // 1) Vercel формат
  let r = await fetch(`${KV_URL}/zadd/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ score, member }),
  });
  if (r.ok) return true;

  // 2) Upstash масив елементів
  r = await fetch(`${KV_URL}/zadd/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ members: [{ score, member }] }),
  });
  if (r.ok) return true;

  // 3) Path-варіант
  r = await fetch(`${KV_URL}/zadd/${encodeURIComponent(key)}/${score}/${encodeURIComponent(member)}`, {
    method: 'POST',
    headers: HEADERS,
  });
  return r.ok;
}

export async function kvZRem(key: string, member: string): Promise<boolean> {
  if (!KV_URL || !KV_TOKEN) return false;
  const r = await fetch(`${KV_URL}/zrem/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ member }),
  });
  return r.ok;
}

function parseZResult(j: any): string[] {
  const arr = (j && Array.isArray(j.result)) ? j.result : [];
  const out: string[] = [];
  for (const v of arr) if (typeof v === 'string') out.push(v);
  return out;
}

export async function kvZRange(key: string, start = 0, stop = -1): Promise<string[]> {
  if (!KV_URL || !KV_TOKEN) return [];
  const r = await fetch(`${KV_URL}/zrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    headers: HEADERS, cache: 'no-store'
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null as any);
  return parseZResult(j);
}

/** Сумісність із кодом, що очікує zrevrange */
export async function kvZrevrange(key: string, start = 0, stop = -1): Promise<string[]> {
  if (!KV_URL || !KV_TOKEN) return [];
  const r = await fetch(`${KV_URL}/zrevrange/${encodeURIComponent(key)}/${start}/${stop}`, {
    headers: HEADERS, cache: 'no-store'
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null as any);
  return parseZResult(j);
}

export function cuid(): string {
  return Math.random().toString(36).slice(2).toUpperCase() + Date.now().toString(36).toUpperCase();
}

/* =========================
   JSON HELPERS (ADD-ONLY)
   ========================= */
export async function kvGetJSON<T = unknown>(key: string): Promise<T | null> {
  const raw = await kvGet(key);
  if (raw == null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function kvSetJSON<T = unknown>(key: string, value: T): Promise<boolean> {
  try { return await kvSet(key, JSON.stringify(value)); } catch { return false; }
}
