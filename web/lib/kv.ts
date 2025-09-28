// web/lib/kv.ts
// Thin REST client for Vercel KV (Upstash-compatible) with explicit read/write tokens.
// Provides list/create helpers for Campaigns using LIST index + per-item JSON.

type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: {
    v1?: { op: 'contains' | 'equals'; value: string };
    v2?: { op: 'contains' | 'equals'; value: string };
  };
  exp?: Record<string, unknown>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

const INDEX_KEY = 'campaign:index';
const ITEM_KEY = (id: string) => `campaign:${id}`;

const KV_REST_API_URL = process.env.KV_REST_API_URL!;
const KV_READ_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN!;
const KV_WRITE_TOKEN = process.env.KV_REST_API_TOKEN!;

function assertEnv() {
  if (!KV_REST_API_URL) throw new Error('KV_REST_API_URL is missing');
  if (!KV_READ_TOKEN) throw new Error('KV_REST_API_READ_ONLY_TOKEN is missing');
  if (!KV_WRITE_TOKEN) throw new Error('KV_REST_API_TOKEN (write) is missing');
}
assertEnv();

async function kvFetch(path: string, init: RequestInit, write = false) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${write ? KV_WRITE_TOKEN : KV_READ_TOKEN}`);
  headers.set('Content-Type', 'application/json');

  const url = KV_REST_API_URL.replace(/\/$/, '') + path;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  if (!res.ok) {
    // Surface detailed error message for easier debugging in logs/console
    let body = '';
    try { body = await res.text(); } catch {}
    console.error('KV error', { path, status: res.status, body });
    throw new Error(`KV ${write ? 'write' : 'read'} failed: ${res.status}`);
  }
  return res;
}

async function kvGet<T = string>(key: string): Promise<T | null> {
  const r = await kvFetch(`/get/${encodeURIComponent(key)}`, { method: 'GET' }, false);
  const j = await r.json();
  return (j?.result ?? null) as T | null;
}

async function kvSet(key: string, value: string) {
  await kvFetch(`/set/${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify({ value }) }, true);
}

async function kvLRange(key: string, start = 0, stop = -1): Promise<string[]> {
  const r = await kvFetch(`/lrange/${encodeURIComponent(key)}/${start}/${stop}`, { method: 'GET' }, false);
  const j = await r.json();
  return (j?.result ?? []) as string[];
}

async function kvLPush(key: string, value: string) {
  await kvFetch(`/lpush/${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify({ value }) }, true);
}

// Public read helpers
export const kvRead = {
  async getRaw(key: string) {
    return kvGet<string>(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },
  async listCampaigns(): Promise<Campaign[]> {
    const ids = await kvLRange(INDEX_KEY, 0, -1);
    const items: Campaign[] = [];
    for (const id of ids) {
      const raw = await kvGet<string>(ITEM_KEY(id));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Campaign;
        items.push(parsed);
      } catch {
        // skip corrupt rows
      }
    }
    return items;
  },
};

// Public write helpers
export const kvWrite = {
  async setRaw(key: string, value: string) {
    await kvSet(key, value);
  },
  async lpush(key: string, value: string) {
    await kvLPush(key, value);
  },
  async createCampaign(input: Partial<Campaign>): Promise<Campaign> {
    const id = (input.id ?? Date.now().toString()).toString();
    const full: Campaign = {
      id,
      name: input.name ?? 'Unnamed',
      created_at: Number(id) || Date.now(),
      active: input.active ?? true,
      base_pipeline_id: input.base_pipeline_id,
      base_status_id: input.base_status_id,
      base_pipeline_name: input.base_pipeline_name ?? null,
      base_status_name: input.base_status_name ?? null,
      rules: input.rules ?? {},
      exp: input.exp ?? {},
      v1_count: input.v1_count ?? 0,
      v2_count: input.v2_count ?? 0,
      exp_count: input.exp_count ?? 0,
    };

    await kvSet(ITEM_KEY(id), JSON.stringify(full));
    await kvLPush(INDEX_KEY, id);
    return full;
  },
};

// Small utility exported for reuse in API routes if needed later
export const campaignKeys = {
  INDEX_KEY,
  ITEM_KEY,
};
