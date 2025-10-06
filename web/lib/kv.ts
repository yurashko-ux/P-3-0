// web/lib/kv.ts
// ❗️НОВЕ: у listCampaigns() додаємо __index_id і гарантуємо obj.id = __index_id, якщо збережений id зламаний.
import { readFile } from 'node:fs/promises';

export const campaignKeys = {
  INDEX_KEY: 'campaign:index',
  ITEM_KEY: (id: string) => `campaign:${id}`,
  ALT_INDEX_KEYS: ['cmp:ids', 'campaigns:index'] as const,
  ALT_ITEM_KEYS: [(id: string) => `cmp:item:${id}`] as const,
};

const BASE = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ''
).replace(/\/$/, '');
const WR_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  '';
const RD_TOKEN =
  process.env.KV_REST_API_READ_ONLY_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  WR_TOKEN;

let directKv: typeof import('@vercel/kv').kv | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  directKv = require('@vercel/kv').kv;
} catch {
  directKv = null;
}

async function rest(path: string, opts: RequestInit = {}, ro = false) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ro ? RD_TOKEN : WR_TOKEN}`,
  };
  const res = await fetch(`${BASE}/${path}`, { ...opts, headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res;
}

async function kvGetRaw(key: string) {
  if (BASE && RD_TOKEN) {
    const res = await rest(`get/${encodeURIComponent(key)}`, {}, true).catch(() => null);
    if (res) return res.text();
  }
  if (directKv) {
    const value = await directKv.get(key).catch(() => null as unknown);
    if (value == null) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return null as string | null;
}

async function kvSetRaw(key: string, value: string) {
  if (BASE && WR_TOKEN) {
    await rest(`set/${encodeURIComponent(key)}`, { method: 'POST', body: value }).catch(() => {});
    return;
  }
  if (directKv) {
    await directKv.set(key, value).catch(() => {});
  }
}

// — robust LRANGE парсер (масив / {result} / {data} / рядок)
async function kvLRange(key: string, start = 0, stop = -1) {
  if (!BASE || !RD_TOKEN) {
    if (directKv) {
      try {
        const arr = await directKv.lrange<string>(key, start, stop);
        if (Array.isArray(arr)) return arr.map(String);
      } catch {
        return [] as string[];
      }
      return [] as string[];
    }
    return [] as string[];
  }
  const res = await rest(`lrange/${encodeURIComponent(key)}/${start}/${stop}`, {}, true).catch(() => null);
  if (!res) return [] as string[];

  let txt = '';
  try { txt = await res.text(); } catch { return []; }

  let payload: any = null;
  try { payload = JSON.parse(txt); } catch { payload = txt; }

  let arr: any[] = [];
  if (Array.isArray(payload)) arr = payload;
  else if (payload && Array.isArray(payload.result)) arr = payload.result;
  else if (payload && Array.isArray(payload.data)) arr = payload.data;
  else if (typeof payload === 'string') {
    try {
      const again = JSON.parse(payload);
      if (Array.isArray(again)) arr = again;
      else if (again && Array.isArray(again.result)) arr = again.result;
      else if (again && Array.isArray(again.data)) arr = again.data;
    } catch {}
  }

  return arr
    .map((x: any) =>
      typeof x === 'string'
        ? x
        : (x?.value ?? x?.member ?? x?.id ?? '')
    )
    .filter(Boolean)
    .map(String);
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
      } catch { break; }
    }
    s = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');
    if (/^-?\d+$/.test(s)) return s.replace(/^0+(?=\d)/, '');
    const m = s.match(/\d+/);
    if (m) return m[0].replace(/^0+(?=\d)/, '');
    return '';
  }
  if (typeof raw === 'object') {
    const cand = (raw as any).value ?? (raw as any).id ?? (raw as any).member ?? '';
    return normalizeIdRaw(cand, depth - 1);
  }
  return '';
}

type OfflineSnapshot = {
  ids: string[];
  items: Map<string, string>;
};

let offlineSnapshotPromise: Promise<OfflineSnapshot | null> | null = null;

async function loadOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  if (offlineSnapshotPromise) return offlineSnapshotPromise;

  offlineSnapshotPromise = (async () => {
    const inline = (process.env.KV_CAMPAIGNS_SNAPSHOT_JSON || '').trim();
    const filePath = (process.env.KV_CAMPAIGNS_SNAPSHOT_FILE || '').trim();

    let payload = inline;
    if (!payload && filePath) {
      try {
        payload = await readFile(filePath, 'utf8');
      } catch {
        payload = '';
      }
    }

    if (!payload) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }

    const ids = new Set<string>();
    const items = new Map<string, string>();

    const pushCampaign = (value: any, hint?: any) => {
      if (value == null) return;

      let obj: any = value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          obj = { id: trimmed };
        }
      }

      if (typeof obj !== 'object' || Array.isArray(obj)) return;

      const candidates = [
        obj.id,
        obj.__index_id,
        obj.campaignId,
        obj.campaign_id,
        obj.key,
        hint,
      ];

      let resolved = '';
      for (const candidate of candidates) {
        const normalized = normalizeIdRaw(candidate);
        if (normalized) {
          resolved = normalized;
          break;
        }
      }

      if (!resolved) return;

      ids.add(resolved);
      try {
        items.set(resolved, JSON.stringify(obj));
      } catch {
        // Якщо об'єкт неможливо серіалізувати, ігноруємо його.
      }
    };

    if (Array.isArray(parsed)) {
      parsed.forEach((entry) => pushCampaign(entry));
    } else if (parsed && typeof parsed === 'object') {
      const candidateArrays = [
        parsed.index,
        parsed.ids,
        parsed.list,
        parsed.data,
        parsed.campaigns,
      ];

      for (const arr of candidateArrays) {
        if (!Array.isArray(arr)) continue;
        arr.forEach((entry) => {
          if (parsed.items && typeof parsed.items === 'object') {
            const normalized = normalizeIdRaw(entry);
            if (normalized && normalized in parsed.items) {
              pushCampaign((parsed.items as Record<string, any>)[normalized], normalized);
              return;
            }
          }
          pushCampaign(entry);
        });
      }

      if (parsed.items && typeof parsed.items === 'object') {
        for (const [key, value] of Object.entries(parsed.items as Record<string, any>)) {
          pushCampaign(value, key);
        }
      }
    }

    if (!ids.size) return null;

    return {
      ids: Array.from(ids),
      items,
    } satisfies OfflineSnapshot;
  })();

  return offlineSnapshotPromise;
}

export const kvRead = {
  async getRaw(key: string) {
    return kvGetRaw(key);
  },
  async lrange(key: string, start = 0, stop = -1) {
    return kvLRange(key, start, stop);
  },

  // 🔧 ГАРАНТУЄМО коректний id:
  // - додаємо __index_id (id з індексу LIST)
  // - якщо obj.id зіпсований/порожній — підставляємо __index_id
  async listCampaigns<T extends Record<string, any> = any>(): Promise<T[]> {
    const indexKeys = [campaignKeys.INDEX_KEY, ...campaignKeys.ALT_INDEX_KEYS];
    const ids: string[] = [];
    const seen = new Set<string>();

    const readIndex = async (key: string) => {
      const arr = (await kvLRange(key, 0, -1).catch(() => [])) as string[];
      if (arr && arr.length) return arr;
      const raw = await kvGetRaw(key).catch(() => null as string | null);
      if (!raw) return [] as string[];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
        if (parsed && Array.isArray(parsed.result)) return parsed.result.map(String).filter(Boolean);
        if (parsed && Array.isArray(parsed.data)) return parsed.data.map(String).filter(Boolean);
      } catch {}
      return [] as string[];
    };

    for (const key of indexKeys) {
      const arr = await readIndex(key);
      for (const raw of arr) {
        const id = normalizeIdRaw(raw);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }

    const offline = await loadOfflineSnapshot();
    if (offline) {
      for (const offlineId of offline.ids) {
        if (!offlineId || seen.has(offlineId)) continue;
        seen.add(offlineId);
        ids.push(offlineId);
      }
    }

    const out: T[] = [];

    for (const indexId of ids) {
      let raw: string | null = null;
      const itemKeys = [
        campaignKeys.ITEM_KEY(indexId),
        ...campaignKeys.ALT_ITEM_KEYS.map((fn) => fn(indexId)),
      ];
      if (offline?.items.has(indexId)) {
        raw = offline.items.get(indexId) ?? null;
      }
      for (const key of itemKeys) {
        if (raw && raw !== 'null' && raw !== 'undefined') break;
        const candidate = await kvGetRaw(key);
        if (candidate && candidate !== 'null' && candidate !== 'undefined') {
          raw = candidate;
          break;
        }
      }
      if (!raw || raw === 'null' || raw === 'undefined') continue;
      try {
        const obj = JSON.parse(raw);

        const safeFromObj = normalizeIdRaw(obj?.id);
        const safeId = safeFromObj || String(indexId);

        obj.__index_id = String(indexId); // ← для надійності
        obj.id = safeId;                  // ← тепер завжди є коректний id (рядок-число)

        // Вирівнюємо camelCase / snake_case, щоб далі було простіше працювати з об'єктом
        if (obj.createdAt && !obj.created_at) obj.created_at = obj.createdAt;
        if (obj.created_at && !obj.createdAt) obj.createdAt = obj.created_at;
        if (obj.name == null && obj.title) obj.name = obj.title;

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
  async setRaw(key: string, value: string) { return kvSetRaw(key, value); },
  async lpush(key: string, value: string) {
    if (BASE && WR_TOKEN) {
      await rest(`lpush/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: JSON.stringify({ value }),
      }).catch(() => {});
      return;
    }
    if (directKv) {
      await directKv.lpush(key, value).catch(() => {});
    }
  },
  async createCampaign(input: any) {
    const id = String(input?.id || Date.now());
    const created_at =
      typeof input?.created_at === 'number'
        ? input.created_at
        : (Number(id) && Number.isFinite(Number(id)) ? Number(id) : Date.now());

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

    await kvSetRaw(campaignKeys.ITEM_KEY(id), JSON.stringify(item));
    await rest(`lpush/${encodeURIComponent(campaignKeys.INDEX_KEY)}`, {
      method: 'POST',
      body: JSON.stringify({ value: id }),
    }).catch(() => {});
    return item;
  },
};
