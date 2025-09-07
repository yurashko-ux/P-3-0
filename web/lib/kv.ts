// web/lib/kv.ts
// Простий REST-клієнт до Vercel KV (Upstash Redis REST API).
// Потрібні ENV: KV_REST_API_URL, KV_REST_API_TOKEN

const base = process.env.KV_REST_API_URL!;
const token = process.env.KV_REST_API_TOKEN!;

function req(path: string, init?: RequestInit) {
  if (!base || !token) throw new Error("KV env missing: KV_REST_API_URL / KV_REST_API_TOKEN");
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
}

async function assertOk(r: Response, label: string) {
  if (!r.ok) throw new Error(`${label} failed: ${r.status} ${await r.text()}`);
}

export async function kvSet(key: string, value: unknown) {
  const r = await req(
    `/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`,
    { method: "POST" }
  );
  await assertOk(r, `KV SET ${key}`);
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const r = await req(`/get/${encodeURIComponent(key)}`, { method: "GET" });
  await assertOk(r, `KV GET ${key}`);
  const { result } = await r.json();
  if (result == null) return null;
  try {
    return JSON.parse(result) as T;
  } catch {
    return result as T;
  }
}

export async function kvDel(key: string) {
  const r = await req(`/del/${encodeURIComponent(key)}`, { method: "POST" });
  await assertOk(r, `KV DEL ${key}`);
}

export async function kvZadd(key: string, score: number, member: string) {
  const r = await req(
    `/zadd/${encodeURIComponent(key)}/${score}/${encodeURIComponent(member)}`,
    { method: "POST" }
  );
  await assertOk(r, `KV ZADD ${key}`);
}

export async function kvZrem(key: string, member: string) {
  const r = await req(
    `/zrem/${encodeURIComponent(key)}/${encodeURIComponent(member)}`,
    { method: "POST" }
  );
  await assertOk(r, `KV ZREM ${key}`);
}

export async function kvZrevrange(key: string, start = 0, stop = 199): Promise<string[]> {
  const r = await req(
    `/zrevrange/${encodeURIComponent(key)}/${start}/${stop}`,
    { method: "GET" }
  );
  await assertOk(r, `KV ZREVRANGE ${key}`);
  const { result } = await r.json();
  return result ?? [];
}

