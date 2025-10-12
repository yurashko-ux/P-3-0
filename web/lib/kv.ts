// web/lib/kv.ts
// Уніфікований доступ до Vercel KV із підтримкою нової схеми збереження кампаній (ZSET)
// та сумісністю зі старими LIST-ключами.

import { kv } from '@vercel/kv';

export const campaignKeys = {
  INDEX_KEY: 'campaigns:index',
  ITEM_KEY: (id: string) => `campaigns:${id}`,
  LEGACY_INDEX_KEY: 'cmp:ids',
  LEGACY_ITEM_KEY: (id: string) => `cmp:item:${id}`,
};

function toJsonString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
}

// --- базові утиліти ---
export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const value = await kv.get<T>(key);
  return (value ?? null) as T | null;
}

export async function kvSet<T = unknown>(key: string, value: T): Promise<void> {
  await kv.set(key, value as any);
}

export async function kvDel(key: string): Promise<void> {
  await kv.del(key);
}

// NOTE: Capital A — kvZAdd
export async function kvZAdd(key: string, score: number, member: string): Promise<void> {
  await kv.zadd(key, { score, member });
}

export async function kvZRange(key: string, start = 0, stop = -1, opts?: { rev?: boolean }): Promise<string[]> {
  const result = await kv.zrange<string[]>(key, start, stop, opts);
  if (Array.isArray(result)) return result.map(String);
  return [];
}

async function kvGetRaw(key: string): Promise<string | null> {
  const value = await kv.get(key);
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return toJsonString(value);
}

async function kvSetRaw(key: string, value: string): Promise<void> {
  await kv.set(key, value);
}

async function kvLRange(key: string, start = 0, stop = -1): Promise<string[]> {
  try {
    const list = await kv.lrange<string[]>(key, start, stop);
    if (Array.isArray(list)) return list.map(String);
  } catch {}
  return [];
}

// === універсальна нормалізація будь-якої форми id ===
function normalizeIdRaw(raw: any, depth = 6): string {
  if (raw == null || depth <= 0) return '';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    let s = raw.trim();
    for (let i = 0; i < 5; i++) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string' || typeof parsed === 'number') {
          return normalizeIdRaw(parsed, depth - 1);
        }
        if (parsed && typeof parsed === 'object') {
          const cand = (parsed as any).value ?? (parsed as any).id ?? (parsed as any).member ?? '';
          if (cand) return normalizeIdRaw(cand, depth - 1);
        }
        break;
      } catch {
        break;
      }
    }
    s = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');
    const m = s.match(/\d{10,}/);
    if (m) return m[0];
    return '';
  }
  if (typeof raw === 'object') {
    const cand = (raw as any).value ?? (raw as any).id ?? (raw as any).member ?? '';
    return normalizeIdRaw(cand, depth - 1);
  }
  return '';
}

async function readIndexIds(start = 0, stop = -1): Promise<string[]> {
  const primary = await kvZRange(campaignKeys.INDEX_KEY, start, stop, { rev: true });
  if (primary.length) return primary;
  // fallback до legacy LIST-ключа
  return kvLRange(campaignKeys.LEGACY_INDEX_KEY, start, stop);
}

export const kvRead = {
  async getRaw(key: string) {
    return kvGetRaw(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    if (key === campaignKeys.INDEX_KEY) return readIndexIds(start, stop);
    return kvLRange(key, start, stop);
  },

  // 🔧 ГАРАНТУЄМО коректний id:
  // - додаємо __index_id (id з індексу LIST/ZSET)
  // - якщо obj.id зіпсований/порожній — підставляємо __index_id
  async listCampaigns<T extends Record<string, any> = any>(): Promise<T[]> {
    const ids = await readIndexIds(0, -1);
    const out: T[] = [];

    for (const indexId of ids) {
      const raw =
        (await kvGetRaw(campaignKeys.ITEM_KEY(indexId))) ??
        (await kvGetRaw(campaignKeys.LEGACY_ITEM_KEY(indexId)));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);

        const safeFromObj = normalizeIdRaw(obj?.id);
        const safeId = safeFromObj || String(indexId);

        obj.__index_id = String(indexId); // ← для надійності
        obj.id = safeId; // ← тепер завжди є коректний id (рядок-число)

        if (!obj.created_at) {
          const ts = Number(safeId);
          if (Number.isFinite(ts)) obj.created_at = ts;
        }
        out.push(obj);
      } catch {
        // ігноруємо биті JSON
      }
    }
    return out;
  },
};

export const kvWrite = {
  async setRaw(key: string, value: string) {
    await kvSetRaw(key, value);
  },
  async lpush(key: string, value: string) {
    try {
      await kv.lpush(key, value);
    } catch {}
  },
  async createCampaign(input: any) {
    const id = String(input?.id || Date.now());
    const created_at =
      typeof input?.created_at === 'number'
        ? input.created_at
        : Number.isFinite(Number(id))
          ? Number(id)
          : Date.now();

    const item = {
      id,
      name: input?.name || 'UI-created',
      created_at,
      active: Boolean(input?.active ?? false),
      base_pipeline_id: input?.base_pipeline_id ?? null,
      base_status_id: input?.base_status_id ?? null,
      base_pipeline_name: input?.base_pipeline_name ?? null,
      base_status_name: input?.base_status_name ?? null,
      rules: input?.rules || {},
      exp: input?.exp || {},
      v1_count: Number(input?.v1_count ?? 0),
      v2_count: Number(input?.v2_count ?? 0),
      exp_count: Number(input?.exp_count ?? 0),
      deleted: false,
    };

    await kvSet(campaignKeys.ITEM_KEY(id), item);
    await kvZAdd(campaignKeys.INDEX_KEY, created_at, id);

    // Legacy сумісність
    try {
      await kvSetRaw(campaignKeys.LEGACY_ITEM_KEY(id), JSON.stringify(item));
      await kv.lpush(campaignKeys.LEGACY_INDEX_KEY, id);
    } catch {}

    return item;
  },
};
