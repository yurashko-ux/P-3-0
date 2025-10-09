// web/lib/kv.ts
// ❗️НОВЕ: у listCampaigns() додаємо __index_id і гарантуємо obj.id = __index_id, якщо збережений id зламаний.

import type { VercelKV } from '@vercel/kv';

export const campaignKeys = {
  INDEX_KEY: 'campaign:index',
  ITEM_KEY: (id: string) => `campaign:${id}`,
};

const BASE = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const WR_TOKEN = process.env.KV_REST_API_TOKEN || '';
const RD_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || WR_TOKEN;

let legacyKvPromise: Promise<VercelKV | null> | null = null;

async function getLegacyKv(): Promise<VercelKV | null> {
  if (legacyKvPromise) return legacyKvPromise;
  legacyKvPromise = (async () => {
    try {
      const mod = await import('@vercel/kv');
      return mod?.kv ?? null;
    } catch {
      return null;
    }
  })();
  return legacyKvPromise;
}

function pickStr(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function normalizeTarget(target: any):
  | { pipeline?: string; status?: string; pipelineName?: string; statusName?: string }
  | undefined {
  if (!target || typeof target !== 'object') return undefined;
  const pipeline =
    pickStr((target as any).pipeline) ||
    pickStr((target as any).pipeline_id) ||
    pickStr((target as any).pipelineId);
  const status =
    pickStr((target as any).status) ||
    pickStr((target as any).status_id) ||
    pickStr((target as any).statusId);
  const pipelineName =
    pickStr((target as any).pipelineName) || pickStr((target as any).pipeline_name);
  const statusName =
    pickStr((target as any).statusName) || pickStr((target as any).status_name);
  const out = { pipeline, status, pipelineName, statusName };
  if (pipeline || status || pipelineName || statusName) return out;
  return undefined;
}

type Rule = { op: 'contains' | 'equals'; value: string };

function normalizeRule(primary: any, fallback?: any): Rule | undefined {
  const source = primary ?? fallback;
  if (source == null) return undefined;

  if (typeof source === 'object' && 'value' in source) {
    const value = pickStr((source as any).value);
    if (!value) return undefined;
    const opRaw = pickStr((source as any).op)?.toLowerCase();
    const op: Rule['op'] = opRaw === 'equals' ? 'equals' : 'contains';
    return { op, value };
  }

  const value = pickStr(source);
  if (!value) return undefined;
  return { op: 'equals', value };
}

async function listLegacyCampaigns(): Promise<Record<string, any>[]> {
  const kv = await getLegacyKv();
  if (!kv) return [];

  let ids: string[] = [];
  try {
    const arr = await kv.lrange<string>('cmp:ids', 0, -1);
    if (Array.isArray(arr)) ids.push(...arr);
  } catch {}

  try {
    const arr = await kv.get<string[] | null>('cmp:ids');
    if (Array.isArray(arr)) ids.push(...arr);
  } catch {}

  const uniqueIds = Array.from(new Set(ids.filter(Boolean).map((x) => String(x))));
  if (!uniqueIds.length) return [];

  const out: Record<string, any>[] = [];
  for (const indexId of uniqueIds) {
    let item: any = null;
    try {
      item = await kv.get(`cmp:item:${indexId}`);
    } catch {}
    if (!item || typeof item !== 'object') continue;

    const obj = { ...(item as Record<string, any>) };
    const safeId = normalizeIdRaw(obj?.id) || String(indexId);

    const base = normalizeTarget(obj.base) ?? obj.base;
    const t1 = normalizeTarget(obj.t1) ?? obj.t1;
    const t2 = normalizeTarget(obj.t2) ?? obj.t2;
    const texp = normalizeTarget(obj.texp) ?? obj.texp;

    const rulesRaw = typeof obj.rules === 'object' && obj.rules ? obj.rules : {};
    const rules: Record<string, Rule> = {};
    const r1 = normalizeRule((rulesRaw as any).v1, obj.v1);
    if (r1) rules.v1 = r1;
    const r2 = normalizeRule((rulesRaw as any).v2, obj.v2);
    if (r2) rules.v2 = r2;

    const normalized: Record<string, any> = {
      ...obj,
      id: safeId,
      __index_id: String(indexId),
      name: pickStr(obj.name) || obj.name || `Campaign ${safeId}`,
      active: obj.active !== false,
      base,
      t1,
      t2,
      texp,
    };

    normalized.base_pipeline_id = pickStr(obj.base_pipeline_id) || base?.pipeline || undefined;
    normalized.base_status_id = pickStr(obj.base_status_id) || base?.status || undefined;
    normalized.base_pipeline_name =
      pickStr(obj.base_pipeline_name) || base?.pipelineName || undefined;
    normalized.base_status_name =
      pickStr(obj.base_status_name) || base?.statusName || undefined;

    if (Object.keys(rules).length) {
      normalized.rules = { ...rulesRaw, ...rules };
    }

    out.push(normalized);
  }

  return out;
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
  if (!BASE || !RD_TOKEN) return null as string | null;
  const res = await rest(`get/${encodeURIComponent(key)}`, {}, true).catch(() => null);
  if (!res) return null;
  return res.text();
}

async function kvSetRaw(key: string, value: string) {
  if (!BASE || !WR_TOKEN) return;
  await rest(`set/${encodeURIComponent(key)}`, { method: 'POST', body: value }).catch(() => {});
}

// — robust LRANGE парсер (масив / {result} / {data} / рядок)
async function kvLRange(key: string, start = 0, stop = -1) {
  if (!BASE || !RD_TOKEN) return [] as string[];
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
    const ids = (await kvLRange(campaignKeys.INDEX_KEY, 0, -1)) as string[];
    const out: T[] = [];
    const seen = new Set<string>();

    for (const indexId of ids) {
      const raw = await kvGetRaw(campaignKeys.ITEM_KEY(indexId));
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);

        const safeFromObj = normalizeIdRaw(obj?.id);
        const safeId = safeFromObj || String(indexId);

        obj.__index_id = String(indexId); // ← для надійності
        obj.id = safeId;                  // ← тепер завжди є коректний id (рядок-число)

        if (!obj.created_at) {
          const ts = Number(safeId);
          if (Number.isFinite(ts)) obj.created_at = ts;
        }

        const rulesRaw = typeof obj.rules === 'object' && obj.rules ? obj.rules : {};
        const normalizedRules: Record<string, Rule> = {};
        const nr1 = normalizeRule((rulesRaw as any).v1);
        if (nr1) normalizedRules.v1 = nr1;
        const nr2 = normalizeRule((rulesRaw as any).v2);
        if (nr2) normalizedRules.v2 = nr2;
        if (Object.keys(normalizedRules).length) {
          obj.rules = { ...rulesRaw, ...normalizedRules };
        }

        out.push(obj);
        seen.add(String(safeId));
      } catch {
        // ігноруємо биті JSON
      }
    }

    const legacy = await listLegacyCampaigns();
    for (const item of legacy) {
      const id = pickStr(item?.id) || pickStr(item?.__index_id);
      if (!id || seen.has(id)) continue;
      out.push(item as T);
      seen.add(id);
    }

    return out;
  },
};

export const kvWrite = {
  async setRaw(key: string, value: string) { return kvSetRaw(key, value); },
  async lpush(key: string, value: string) {
    if (!BASE || !WR_TOKEN) return;
    await rest(`lpush/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }).catch(() => {});
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
