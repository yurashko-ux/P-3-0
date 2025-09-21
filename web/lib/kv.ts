// web/lib/kv.ts
// Minimal in-memory KV adapter with a future hook for Vercel KV via REST.
// Safe for serverless cold starts (volatile). Suitable for tests and mocks.

type Primitive = string | number | boolean | null;
type JSONValue = Primitive | JSONObject | JSONArray;
interface JSONObject { [key: string]: JSONValue }
interface JSONArray extends Array<JSONValue> {}

// ---- In-memory store ----
const map = new Map<string, string>();
const zsets = new Map<string, Array<{ member: string; score: number }>>();

// Helpers
function serialize(v: any): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}
function deserialize<T = any>(raw: string | undefined | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T; // allow plain strings
  }
}

// ---- Public API (compatible signatures) ----
export async function kvGet<T = any>(key: string): Promise<T | null> {
  return deserialize<T>(map.get(key) ?? null);
}

export async function kvSet(key: string, value: any): Promise<void> {
  map.set(key, serialize(value));
}

export async function kvMGet<T = any>(keys: string[]): Promise<(T | null)[]> {
  return keys.map((k) => deserialize<T>(map.get(k) ?? null));
}

export async function kvZAdd(
  key: string,
  score: number,
  member: string
): Promise<void> {
  const arr = zsets.get(key) ?? [];
  // upsert by member
  const idx = arr.findIndex((x) => x.member === member);
  if (idx >= 0) arr[idx].score = score;
  else arr.push({ member, score });
  // keep sorted asc by score, then by member to stabilize
  arr.sort((a, b) => (a.score - b.score) || a.member.localeCompare(b.member));
  zsets.set(key, arr);
}

export async function kvZRange(
  key: string,
  start: number,
  stop: number
): Promise<string[]> {
  const arr = zsets.get(key) ?? [];
  // stop is inclusive in Redis semantics
  const end = stop < 0 ? arr.length + stop : stop;
  const slice = arr.slice(
    start < 0 ? Math.max(arr.length + start, 0) : start,
    (end < 0 ? Math.max(arr.length + end, 0) : end) + 1
  );
  return slice.map((x) => x.member);
}

// ---- Namespaced helpers (optional but handy) ----
export async function kvIncr(key: string, by = 1): Promise<number> {
  const cur = Number((await kvGet<string | number>(key)) ?? 0);
  const next = cur + by;
  await kvSet(key, next);
  return next;
}

// ---- Future: switch to Vercel KV when ENV is present ----
// For now we always use in-memory. When ready:
// const useVercel = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
// if (useVercel) { /* implement REST calls keeping the same exports */ }
