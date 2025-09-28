// web/lib/kv.ts
// Thin REST client for Vercel KV (Upstash-compatible) with tolerant token handling.
// - НЕ кидаємо помилки під час імпорту модуля (лише warn).
// - Читання з індексу нормалізує значення типу {"value":"..."} → "...".
// - Підтримуємо primary 'campaign:index' і legacy 'campaigns:index'.
// - Для сумісності пушимо id в обидва індекси.

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

const KV_REST_API_URL = process.env.KV_REST_API_URL || '';
const KV_READ_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || '';
const KV_WRITE_TOKEN = process.env.KV_REST_API_TOKEN || '';

// ⚠️ Лише warn — без throw при імпорті
(function warnEnv() {
  if (!KV_REST_API_URL) console.warn('[kv] KV_REST_API_URL is missing');
  if (!KV_READ_TOKEN && !KV_WRITE_TOKEN) {
    console.warn('[kv] KV tokens missing: set KV_REST_API_TOKEN (write) and/or KV_REST_API_READ_ONLY_TOKEN (read)');
  }
})();

// Обираємо токен: для read → RO або падіння на write; для write → лише write
function pickToken(write: boolean): string | null {
  if (write) return KV_WRITE_TOKEN || null;
  return KV_READ_TOKEN || KV_WRITE_TOKEN || null;
}

async function kvFetch(path: string, init: RequestInit, write = false) {
  const token = pickToken(write);
  if (!KV_REST_API_URL) throw new Error('KV base URL missing (KV_REST_API_URL)');
  if (!token) {
    throw new Error(
      write
        ? 'KV write token missing (KV_REST_API_TOKEN)'
        : 'KV read/write tokens missing (KV_REST_API_READ_ONLY_TOKEN / KV_REST_API_TOKEN)'
    );
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');

  const url = KV_REST_API_URL.replace(/\/$/, '') + path;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    console.error('KV error', { path, status: res.status, body, write });
    throw new Error(`KV ${write ? 'write' : 'read'} failed: ${res.status}`);
  }
  return res;
}

// ---- Низькорівневі хелпери (визначені ДО експорту kvRead/kvWrite) ----
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

/** Нормалізація id: якщо елемент LIST має вигляд '{"value":"1759..."}' → повертаємо '1759...' */
function normalizeId(id: string): string {
  if (!id) return id;
  if (id[0] !== '{') return id;
  try {
    const obj = JSON.parse(id);
    if (obj && typeof obj.value === 'string' && obj.value) return obj.value;
  } catch { /* ignore */ }
  return id;
}

// ---- Публічні API ----
export const kvRead = {
  async getRaw(key: string) {
    return kvGet<string>(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },
  async listCampaigns(): Promise<Campaign[]> {
    // Primary index
    let ids: string[] = [];
    try {
      ids = (await kvLRange(INDEX_KEY, 0, -1)).map(normalizeId);
    } catch (e) {
      console.warn('[kv] listCampaigns primary index read failed:', (e as Error).message);
    }

    // Legacy index (back-compat)
    if (!ids || ids.length === 0) {
      try {
        const legacy = await kvLRange('campaigns:index', 0, -1);
        if (legacy?.length) ids = legacy.map(normalizeId);
      } catch { /* ignore */ }
    }

    const items: Campaign[] = [];
    for (const id of ids) {
      try {
        const raw = await kvGet<string>(ITEM_KEY(id));
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Campaign;
        items.push(parsed);
      } catch (e) {
        console.warn('[kv] failed to read/parse item', id, (e as Error).message);
      }
    }
    return items;
  },
};

export const kvWrite = {
  async setRaw(key: string, value: string) {
    await kvSet(key, value);
  },
  async lpush(key: string, value: string) {
    await kvLPush(key, String(value)); // гарантуємо простий рядок id
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
    // legacy індекс — до завершення міграції
    try { await kvLPush('campaigns:index', id); } catch { /* ignore */ }

    return full;
  },
};

export const campaignKeys = {
  INDEX_KEY,
  ITEM_KEY,
};
